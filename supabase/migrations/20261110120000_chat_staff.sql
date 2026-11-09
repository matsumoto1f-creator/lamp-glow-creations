-- Staff group chat inside Lamp (first part of the in-app chat; map:
-- https://claude.ai/artifact/AuVfw94YW7pUFkv5qBF78x). Stevie's ask: a group chat in the app where the
-- team can have conversations. Merchant conversations come in a later file.
--
--   chat_threads    a conversation: a room or a direct message
--   chat_messages   its messages: kept as written, never edited; an admin can redact one
--   chat_members    who is in a direct message or a room an admin made
--   chat_reads      when each person last read each conversation (unread marks)
--
-- Rooms:
--   * "All staff": every rep and admin;
--   * one room per team lead: the lead and the reps whose reps.admin_slug is theirs ("Zeus's team").
--     The database makes these and keeps them in step when reps change (ensure_staff_rooms());
--   * rooms an admin makes with chosen staff (create_room()).
-- Direct messages: one conversation per pair of staff, made on first use (open_direct()).
--
-- Who may read: the people in it, and admins (they read every conversation, as the brief asks; say
-- so in Training). Who may write: the people in it. An admin reading a direct message they aren't
-- in can't post in it. Anyone without a rep or admin role reads and writes nothing here.
--
-- The database refuses, whatever the browser sends:
--   * a message with a Social Security, EIN, card or account-length number (8 or more digits in a
--     row) in it: chat is no place for them;
--   * a message the browser marks as written by someone else, or as anything but plain text (only
--     thread_id and body may be set; author, role, name and time are stamped here);
--   * more than 20 messages a minute from one person;
--   * any edit or delete from a browser; an admin can redact a message (redact_message()), which keeps
--     the row and who removed it and why.
--
-- New messages show inside Lamp only: the unread marks in Staff > Messages, its count on the tab and
-- under the bell. Chat writes no notifications rows, so nothing reaches Discord or email. Pages look
-- for new messages every 15 seconds; 20261110130000_chat_realtime.sql (separate, optional) makes them
-- arrive at once. Safe to run more than once.

-- ---------- tables ----------

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('room', 'direct')),
  title text check (title is null or char_length(btrim(title)) between 1 and 80),
  audience text,
  team_slug text references public.reps (slug) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_author uuid references auth.users (id) on delete set null
);
alter table public.chat_threads drop constraint if exists chat_threads_room_shape;
alter table public.chat_threads add constraint chat_threads_room_shape check (
  case kind
    when 'room' then title is not null
      and audience in ('all', 'team', 'members')
      and ((audience = 'team') = (team_slug is not null))
    else audience is null and team_slug is null
  end);
create unique index if not exists chat_threads_all_staff_key on public.chat_threads (audience)
  where audience = 'all';
create unique index if not exists chat_threads_team_key on public.chat_threads (team_slug)
  where team_slug is not null;
create index if not exists chat_threads_last_idx on public.chat_threads (last_message_at desc nulls last);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  author uuid references auth.users (id) on delete set null default auth.uid(),
  author_role text not null default 'system' check (author_role in ('rep', 'admin', 'system')),
  author_name text check (author_name is null or char_length(author_name) <= 120),
  created_at timestamptz not null default now(),
  redacted_at timestamptz,
  redacted_by uuid references auth.users (id) on delete set null,
  redact_reason text check (redact_reason is null or char_length(redact_reason) <= 300)
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at desc);
create index if not exists chat_messages_author_idx on public.chat_messages (author, created_at desc);

create table if not exists public.chat_members (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id);

create table if not exists public.chat_reads (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);
create index if not exists chat_reads_user_idx on public.chat_reads (user_id);

-- ---------- who may read, who may write ----------

create or replace function public.chat_can_read(_thread uuid, _user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user is not null and public.is_staff(_user) and exists (
    select 1 from public.chat_threads t
    where t.id = _thread
      and (
        public.has_role('admin', _user)
        or t.audience = 'all'
        or (t.audience = 'team' and (
              public.current_rep_slug(_user) = t.team_slug
              or exists (select 1 from public.reps r
                         where r.user_id = _user and r.active and r.admin_slug = t.team_slug)))
        or exists (select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = _user)
      )
  );
$$;
revoke all on function public.chat_can_read(uuid, uuid) from public, anon;
grant execute on function public.chat_can_read(uuid, uuid) to authenticated, service_role;

/** Reading isn't always writing: an admin reads every direct message but posts only in their own. */
create or replace function public.chat_can_post(_thread uuid, _user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user is not null and public.is_staff(_user) and exists (
    select 1 from public.chat_threads t
    where t.id = _thread
      and case
        when t.kind = 'direct' or t.audience = 'members' then
          exists (select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = _user)
        else public.chat_can_read(t.id, _user)
      end
  );
$$;
revoke all on function public.chat_can_post(uuid, uuid) from public, anon;
grant execute on function public.chat_can_post(uuid, uuid) to authenticated, service_role;

-- ---------- what a message may say ----------

/**
 * True when the text carries a number that doesn't belong in chat: a Social Security number (3-2-4
 * with dashes or spaces), an EIN (2-7), a card number (4-4-4-x), or 8 or more digits in a row
 * (account and routing numbers, an SSN typed without dashes). A phone number written like
 * 201-555-0123 or (201) 555-0123 passes. src/lib/chat.ts holds the same test.
 */
create or replace function public.chat_text_refused(_body text)
returns boolean
language sql
immutable
as $$
  select coalesce(_body, '') ~ '(^|[^0-9])[0-9]{3}[- ][0-9]{2}[- ][0-9]{4}([^0-9]|$)'
      or coalesce(_body, '') ~ '(^|[^0-9])[0-9]{2}-[0-9]{7}([^0-9]|$)'
      or coalesce(_body, '') ~ '(^|[^0-9])[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}([^0-9]|$)'
      or coalesce(_body, '') ~ '[0-9]{8,}';
$$;
grant execute on function public.chat_text_refused(text) to authenticated, service_role;

-- ---------- rules ----------

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_reads enable row level security;

revoke all on public.chat_threads, public.chat_messages, public.chat_members, public.chat_reads
  from anon, authenticated;
grant select on public.chat_threads, public.chat_messages, public.chat_members, public.chat_reads
  to authenticated;
-- only the conversation and the words: everything else is stamped by chat_messages_before
grant insert (thread_id, body) on public.chat_messages to authenticated;
grant all on public.chat_threads, public.chat_messages, public.chat_members, public.chat_reads
  to service_role;

drop policy if exists "People read threads they belong to" on public.chat_threads;
create policy "People read threads they belong to" on public.chat_threads
  for select to authenticated
  using (public.chat_can_read(id));

drop policy if exists "People read messages in their threads" on public.chat_messages;
create policy "People read messages in their threads" on public.chat_messages
  for select to authenticated
  using (public.chat_can_read(thread_id));

drop policy if exists "People write in their threads" on public.chat_messages;
create policy "People write in their threads" on public.chat_messages
  for insert to authenticated
  with check (
    kind = 'text'
    and author = (select auth.uid())
    and public.chat_can_post(thread_id)
  );

drop policy if exists "People see who is in their threads" on public.chat_members;
create policy "People see who is in their threads" on public.chat_members
  for select to authenticated
  using (public.chat_can_read(thread_id));

drop policy if exists "People read their own read marks" on public.chat_reads;
create policy "People read their own read marks" on public.chat_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- stamping a message ----------

/**
 * Who is writing in this conversation, as it shows them: ('rep' | 'admin', name). Also refuses a
 * person sending more than 20 messages a minute. Called by chat_messages_before.
 */
create or replace function public.chat_author_stamp(_thread uuid)
returns table (author_role text, author_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  recent integer;
begin
  select count(*) into recent from public.chat_messages m
   where m.author = me and m.created_at > now() - interval '1 minute';
  if recent >= 20 then
    raise exception 'That''s a lot of messages in a minute. Wait a moment and send again.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.chat_threads where id = _thread) then
    raise exception 'That conversation isn''t there.' using errcode = '22023';
  end if;
  author_role := case when public.has_role('admin', me) then 'admin' else 'rep' end;
  author_name := left(coalesce(
    (select r.name from public.reps r where r.user_id = me and r.active limit 1),
    (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = me),
    'Lamp'), 120);
  return next;
end;
$$;
revoke all on function public.chat_author_stamp(uuid) from public, anon;
grant execute on function public.chat_author_stamp(uuid) to authenticated;

-- Runs as the caller (not security definer) so it can tell a browser's insert, made as
-- "authenticated", from Lamp's own lines written by security definer functions.
create or replace function public.chat_messages_before()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  me uuid := auth.uid();
  s record;
begin
  if current_user not in ('authenticated', 'anon') then
    new.created_at := coalesce(new.created_at, now());
    return new;
  end if;
  if me is null then
    raise exception 'Sign in to send a message.' using errcode = '42501';
  end if;
  new.kind := 'text';
  new.author := me;
  new.created_at := now();
  new.redacted_at := null;
  new.redacted_by := null;
  new.redact_reason := null;
  new.body := btrim(new.body);
  if public.chat_text_refused(new.body) then
    raise exception 'Please don''t send account, card or Social Security numbers in chat; Lamp collects those through the secure application. Phone numbers are fine written like 201-555-0123.'
      using errcode = '22023';
  end if;
  select * into s from public.chat_author_stamp(new.thread_id);
  new.author_role := s.author_role;
  new.author_name := s.author_name;
  return new;
end;
$$;
revoke all on function public.chat_messages_before() from public, anon;

drop trigger if exists chat_messages_before on public.chat_messages;
create trigger chat_messages_before
  before insert on public.chat_messages
  for each row execute function public.chat_messages_before();

-- After a message: the conversation's clock and who spoke last (for unread marks). Nobody is
-- pinged: no notifications rows, so nothing leaves Lamp.
create or replace function public.chat_messages_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_threads set last_message_at = new.created_at, last_author = new.author
   where id = new.thread_id and (last_message_at is null or last_message_at <= new.created_at);
  return new;
end;
$$;
revoke all on function public.chat_messages_after() from public, anon, authenticated;

drop trigger if exists chat_messages_after on public.chat_messages;
create trigger chat_messages_after
  after insert on public.chat_messages
  for each row execute function public.chat_messages_after();

-- ---------- functions the pages call ----------

/** Marks a conversation read for the caller. */
create or replace function public.mark_thread_read(_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.chat_can_read(_thread) then
    raise exception 'Not your conversation.' using errcode = '42501';
  end if;
  insert into public.chat_reads (thread_id, user_id, last_read_at)
  values (_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;
revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

/** Admins only: blanks a message's words and keeps the row, who removed it and why. */
create or replace function public.redact_message(_id bigint, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only admins remove messages.' using errcode = '42501';
  end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'Say why it''s being removed.' using errcode = '22023';
  end if;
  update public.chat_messages
     set body = 'This message was removed by Lamp.',
         redacted_at = now(),
         redacted_by = auth.uid(),
         redact_reason = left(btrim(_reason), 300)
   where id = _id and redacted_at is null;
  if not found then
    raise exception 'No such message, or it was already removed.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.redact_message(bigint, text) from public, anon;
grant execute on function public.redact_message(bigint, text) to authenticated;

/** "All staff", and one room per active team lead (anyone a rep reports to). Safe to call again. */
create or replace function public.ensure_staff_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_threads (kind, title, audience)
  values ('room', 'All staff', 'all')
  on conflict (audience) where audience = 'all' do nothing;
  insert into public.chat_threads (kind, title, audience, team_slug)
  select distinct 'room', left(l.name || '''s team', 80), 'team', l.slug
    from public.reps r join public.reps l on l.slug = r.admin_slug and l.active
   where r.active
  on conflict (team_slug) where team_slug is not null do nothing;
end;
$$;
revoke all on function public.ensure_staff_rooms() from public, anon, authenticated;
grant execute on function public.ensure_staff_rooms() to service_role;

create or replace function public.chat_rooms_follow_teams()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_staff_rooms();
  return null;
exception when others then
  return null; -- a rep change never fails because of chat
end;
$$;
revoke all on function public.chat_rooms_follow_teams() from public, anon, authenticated;
drop trigger if exists chat_rooms_follow_teams on public.reps;
create trigger chat_rooms_follow_teams
  after insert or update of admin_slug, active, name on public.reps
  for each statement execute function public.chat_rooms_follow_teams();

/** Admins only: a room with a name and chosen staff (the admin is always in it). */
create or replace function public.create_room(_title text, _members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Only admins make rooms.' using errcode = '42501';
  end if;
  if coalesce(btrim(_title), '') = '' or char_length(btrim(_title)) > 80 then
    raise exception 'Give the room a name of up to 80 characters.' using errcode = '22023';
  end if;
  insert into public.chat_threads (kind, title, audience, created_by)
  values ('room', btrim(_title), 'members', auth.uid())
  returning id into t;
  insert into public.chat_members (thread_id, user_id, added_by)
  select t, u, auth.uid()
    from (select unnest(coalesce(_members, '{}') || auth.uid()) as u) m
   where public.is_staff(u)
  on conflict do nothing;
  return t;
end;
$$;
revoke all on function public.create_room(text, uuid[]) from public, anon;
grant execute on function public.create_room(text, uuid[]) to authenticated;

/** A direct conversation between the caller and another staff member, made on first use. */
create or replace function public.open_direct(_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  t uuid;
begin
  if not public.is_staff(me) or not public.is_staff(_other) then
    raise exception 'Direct messages are between Lamp staff.' using errcode = '42501';
  end if;
  if _other = me then
    raise exception 'Pick someone else.' using errcode = '22023';
  end if;
  -- one conversation per pair, even if both start it at the same moment
  perform pg_advisory_xact_lock(hashtextextended(least(me, _other)::text || greatest(me, _other)::text, 0));
  select m1.thread_id into t
    from public.chat_members m1
    join public.chat_members m2 on m2.thread_id = m1.thread_id and m2.user_id = _other
    join public.chat_threads th on th.id = m1.thread_id and th.kind = 'direct'
   where m1.user_id = me
   limit 1;
  if t is null then
    insert into public.chat_threads (kind, created_by) values ('direct', me) returning id into t;
    insert into public.chat_members (thread_id, user_id, added_by) values (t, me, me), (t, _other, me);
  end if;
  return t;
end;
$$;
revoke all on function public.open_direct(uuid) from public, anon;
grant execute on function public.open_direct(uuid) to authenticated;

/**
 * Staff > Messages: the caller's conversations, newest first: every room they're in and their direct
 * messages (an admin lists only their own direct messages here, though they may open others').
 * preview: the newest message, cut to 120 characters. unread: something arrived from someone else
 * since the caller last read it.
 */
create or replace function public.my_chat_inbox()
returns table (
  thread_id uuid,
  kind text,
  title text,
  subtitle text,
  preview text,
  last_message_at timestamptz,
  unread boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.kind,
    case t.kind
      when 'room' then t.title
      else coalesce(
        (select string_agg(coalesce(r.name, nullif(p.full_name, ''), p.email, 'Staff'), ', ')
           from public.chat_members m
           left join public.reps r on r.user_id = m.user_id and r.active
           left join public.profiles p on p.id = m.user_id
          where m.thread_id = t.id and m.user_id <> auth.uid()),
        'Direct message')
    end,
    case
      when t.kind = 'direct' then 'Direct message'
      when t.audience = 'all' then 'Everyone on staff'
      when t.audience = 'team' then 'Team room'
      else 'Room'
    end,
    (select case when char_length(lm.body) > 120 then left(lm.body, 119) || '…' else lm.body end
       from public.chat_messages lm where lm.thread_id = t.id
      order by lm.created_at desc, lm.id desc limit 1),
    t.last_message_at,
    t.last_message_at is not null
      and t.last_author is distinct from auth.uid()
      and t.last_message_at > coalesce(
        (select cr.last_read_at from public.chat_reads cr where cr.thread_id = t.id and cr.user_id = auth.uid()),
        '-infinity'::timestamptz)
  from public.chat_threads t
  where public.is_staff()
    and (t.kind <> 'direct' or exists (
          select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = auth.uid()))
    and (t.audience is distinct from 'members' or exists (
          select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = auth.uid()))
    and public.chat_can_read(t.id)
  order by t.last_message_at desc nulls last, t.created_at desc
  limit 300;
$$;
revoke all on function public.my_chat_inbox() from public, anon;
grant execute on function public.my_chat_inbox() to authenticated;

select public.ensure_staff_rooms();

notify pgrst, 'reload schema';

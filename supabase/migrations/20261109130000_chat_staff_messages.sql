-- Staff messages (phase 2 of the in-app chat; map: https://claude.ai/artifact/AuVfw94YW7pUFkv5qBF78x).
-- Runs after 20261109120000_chat_merchant_threads.sql.
--
--   rooms     "All staff" (every rep and admin), one room per team lead (the lead and the reps whose
--             reps.admin_slug is theirs; made and kept up by the database), and rooms an admin makes
--             with chosen people (chat_members)
--   direct    a conversation between two staff members, made on first use by open_direct()
--   inbox     my_chat_inbox(): every conversation the caller may read, newest first, with unread
--   nudge     chat_nudges_due() / chat_mark_nudged(): merchants with a staff reply unread for 15
--             minutes and no nudge in 4 hours, for /api/chat/nudge to email (a link, never the words)
--
-- Who may read: the people in it, and admins (they read everything, as the brief asks; say so in
-- Training). Who may write: the people in it. An admin reading someone else's direct messages can't
-- post into them. Merchants never read a room or a direct message. Room messages ping nobody (the
-- unread count is enough); a direct message notifies the other person with a 100-character preview.
-- The same guard as merchant conversations applies: no SSN, EIN, card or account numbers, no edits.
--
-- Turning on live updates is a separate file (20261109140000_chat_realtime.sql), and so is the
-- 5-minute nudge schedule (20261109150000_chat_nudge_schedule.sql). Safe to run more than once.

-- ---------- conversations of three kinds ----------

alter table public.chat_threads drop constraint if exists chat_threads_kind_check;
alter table public.chat_threads add constraint chat_threads_kind_check
  check (kind in ('merchant', 'room', 'direct'));
alter table public.chat_threads add column if not exists title text;
alter table public.chat_threads add column if not exists audience text;
alter table public.chat_threads add column if not exists team_slug text references public.reps (slug) on delete cascade;
alter table public.chat_threads add column if not exists last_author uuid references auth.users (id) on delete set null;
alter table public.chat_threads drop constraint if exists chat_threads_title_ok;
alter table public.chat_threads add constraint chat_threads_title_ok
  check (title is null or char_length(btrim(title)) between 1 and 80);
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

create table if not exists public.chat_members (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id);
alter table public.chat_members enable row level security;
revoke all on public.chat_members from anon, authenticated;
grant select on public.chat_members to authenticated;
grant all on public.chat_members to service_role;

-- a nudge can be recorded before the merchant has ever opened the conversation
alter table public.chat_reads alter column last_read_at drop not null;
alter table public.chat_reads alter column last_read_at drop default;

-- ---------- who may read, who may write ----------

create or replace function public.chat_can_read(_thread uuid, _user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user is not null and exists (
    select 1 from public.chat_threads t
    where t.id = _thread
      and case t.kind
        when 'merchant' then public.chat_can_use_file(t.application_id, _user)
        else public.is_staff(_user) and (
          public.has_role('admin', _user)
          or (t.audience = 'all')
          or (t.audience = 'team' and (
                public.current_rep_slug(_user) = t.team_slug
                or exists (select 1 from public.reps r
                           where r.user_id = _user and r.active and r.admin_slug = t.team_slug)))
          or exists (select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = _user)
        )
      end
  );
$$;

/** Reading isn't always writing: an admin reads every direct message but posts only in their own. */
create or replace function public.chat_can_post(_thread uuid, _user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user is not null and exists (
    select 1 from public.chat_threads t
    where t.id = _thread
      and case
        when t.kind = 'merchant' then public.chat_can_use_file(t.application_id, _user)
        when t.kind = 'direct' or t.audience = 'members' then
          public.is_staff(_user)
          and exists (select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = _user)
        else public.chat_can_read(t.id, _user)
      end
  );
$$;
revoke all on function public.chat_can_post(uuid, uuid) from public, anon;
grant execute on function public.chat_can_post(uuid, uuid) to authenticated, service_role;

drop policy if exists "People write in their threads" on public.chat_messages;
create policy "People write in their threads" on public.chat_messages
  for insert to authenticated
  with check (
    kind = 'text'
    and author = (select auth.uid())
    and document_id is null
    and public.chat_can_post(thread_id)
  );

drop policy if exists "People see who is in their threads" on public.chat_members;
create policy "People see who is in their threads" on public.chat_members
  for select to authenticated
  using (public.chat_can_read(thread_id));

-- ---------- stamping: staff conversations have no file ----------

create or replace function public.chat_author_stamp(_thread uuid)
returns table (author_role text, author_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.chat_threads;
  a public.applications;
  me uuid := auth.uid();
  recent integer;
begin
  select count(*) into recent from public.chat_messages m
   where m.author = me and m.created_at > now() - interval '1 minute';
  if recent >= 20 then
    raise exception 'That''s a lot of messages in a minute. Wait a moment and send again.'
      using errcode = '22023';
  end if;

  select * into t from public.chat_threads where id = _thread;
  if t.id is null then
    raise exception 'That conversation isn''t there.' using errcode = '22023';
  end if;
  if t.kind = 'merchant' then
    select * into a from public.applications where id = t.application_id;
  end if;

  if a.id is not null and a.user_id = me then
    author_role := 'merchant';
    author_name := coalesce(
      nullif(btrim(a.first_name), ''),
      (select nullif(btrim(p.first_name), '') from public.profiles p where p.id = me),
      'Merchant');
  else
    author_role := case when public.has_role('admin', me) then 'admin' else 'rep' end;
    author_name := coalesce(
      (select r.name from public.reps r where r.user_id = me and r.active limit 1),
      (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = me),
      'Lamp');
  end if;
  author_name := left(author_name, 120);
  return next;
end;
$$;

-- ---------- after a message ----------

create or replace function public.chat_messages_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.chat_threads;
  a public.applications;
  biz text;
  who text;
  title text;
  body text;
  v_link text;
  u uuid;
  recipients uuid[] := '{}';
  pair record;
begin
  update public.chat_threads set last_message_at = new.created_at, last_author = new.author
   where id = new.thread_id and (last_message_at is null or last_message_at <= new.created_at);

  if new.kind <> 'text' then return new; end if;
  select * into t from public.chat_threads where id = new.thread_id;

  -- a direct message: the other person, with a short preview (staff words, never a merchant's)
  if t.kind = 'direct' then
    v_link := '/staff?view=messages&thread=' || t.id;
    title := 'Message from ' || coalesce(new.author_name, 'Lamp');
    body := case when char_length(new.body) > 100 then left(new.body, 99) || '…' else new.body end;
    for u in select m.user_id from public.chat_members m where m.thread_id = t.id and m.user_id is distinct from new.author loop
      continue when exists (
        select 1 from public.notifications n
         where n.user_id = u and n.kind = 'message' and n.link = v_link and n.read_at is null);
      perform public.notify(u, 'message', title, body, v_link, null);
    end loop;
    return new;
  end if;
  -- rooms ping nobody: the unread count is enough
  if t.kind <> 'merchant' then return new; end if;

  select * into a from public.applications where id = t.application_id;
  if a.id is null then return new; end if;
  biz := coalesce(nullif(a.business_name, ''), nullif(a.first_name, ''), 'a file');
  v_link := '/staff?file=' || a.id;

  if a.rep_slug is not null then
    select * into pair from public.rep_and_lead_users(a.rep_slug);
    recipients := array_remove(array[pair.rep_user, pair.lead_user], null);
  elsif new.author_role = 'merchant' then
    select coalesce(array_agg(distinct ur.user_id), '{}') into recipients
      from public.user_roles ur where ur.role = 'admin';
  end if;

  if new.author_role = 'merchant' then
    who := coalesce(nullif(new.author_name, ''), 'The merchant');
    title := 'Message from ' || who || ' at ' || biz;
    body := null;
  else
    title := 'New message on ' || biz;
    body := coalesce(new.author_name, 'Lamp') || ' wrote to the merchant.';
  end if;

  foreach u in array recipients loop
    continue when u is not distinct from new.author;
    continue when exists (
      select 1 from public.notifications n
       where n.user_id = u and n.kind = 'message' and n.application_id = a.id and n.read_at is null);
    perform public.notify(u, 'message', title, body, v_link, a.id);
  end loop;
  return new;
end;
$$;

create or replace function public.mark_thread_read(_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.chat_threads;
begin
  if not public.chat_can_read(_thread) then
    raise exception 'Not your conversation.' using errcode = '42501';
  end if;
  insert into public.chat_reads (thread_id, user_id, last_read_at)
  values (_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;
  select * into t from public.chat_threads where id = _thread;
  update public.notifications n set read_at = now()
   where n.user_id = auth.uid() and n.kind = 'message' and n.read_at is null
     and (
       (t.application_id is not null and n.application_id = t.application_id)
       or n.link = '/staff?view=messages&thread=' || t.id
     );
end;
$$;

-- ---------- rooms ----------

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
  -- one conversation per pair, even if two people start it at the same moment
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

-- ---------- the inbox ----------

/**
 * Every conversation the caller may read, newest first: merchant conversations with at least one
 * message, every room, and their direct messages (an admin's inbox lists only their own direct
 * messages; they open others' from a file or by link). unread: something arrived from someone else
 * since the caller last read it.
 */
create or replace function public.my_chat_inbox()
returns table (
  thread_id uuid,
  kind text,
  title text,
  subtitle text,
  application_id uuid,
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
      when 'merchant' then coalesce(nullif(a.business_name, ''), nullif(a.first_name, ''), 'A merchant')
      when 'room' then t.title
      else coalesce(
        (select string_agg(coalesce(r.name, nullif(p.full_name, ''), p.email, 'Staff'), ', ')
           from public.chat_members m
           left join public.reps r on r.user_id = m.user_id and r.active
           left join public.profiles p on p.id = m.user_id
          where m.thread_id = t.id and m.user_id <> auth.uid()),
        'Direct message')
    end,
    case t.kind
      when 'merchant' then coalesce((select r.name from public.reps r where r.slug = a.rep_slug), 'Unassigned')
      when 'room' then case t.audience when 'all' then 'Everyone on staff' when 'team' then 'Team room' else 'Room' end
      else 'Direct message'
    end,
    t.application_id,
    t.last_message_at,
    t.last_message_at is not null
      and t.last_author is distinct from auth.uid()
      and t.last_message_at > coalesce(
        (select cr.last_read_at from public.chat_reads cr where cr.thread_id = t.id and cr.user_id = auth.uid()),
        '-infinity'::timestamptz)
  from public.chat_threads t
  left join public.applications a on a.id = t.application_id
  where public.is_staff()
    and (t.kind <> 'merchant' or t.last_message_at is not null)
    and (t.kind <> 'direct' or exists (
          select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = auth.uid()))
    and public.chat_can_read(t.id)
  order by t.last_message_at desc nulls last, t.created_at desc
  limit 300;
$$;
revoke all on function public.my_chat_inbox() from public, anon;
grant execute on function public.my_chat_inbox() to authenticated;

-- ---------- the merchant email nudge (server only) ----------

/**
 * Merchants to email: a staff message in their file's conversation has waited unread for 15
 * minutes, and they haven't been nudged about this conversation in 4 hours (or since that
 * message). Only Lamp's server calls it.
 */
create or replace function public.chat_nudges_due()
returns table (
  thread_id uuid,
  user_id uuid,
  email text,
  first_name text,
  rep_slug text,
  waiting_since timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, a.user_id, p.email,
         coalesce(nullif(btrim(a.first_name), ''), nullif(btrim(p.first_name), '')),
         a.rep_slug, s.first_unread
  from public.chat_threads t
  join public.applications a on a.id = t.application_id
  join public.profiles p on p.id = a.user_id
  left join public.chat_reads cr on cr.thread_id = t.id and cr.user_id = a.user_id
  cross join lateral (
    select min(m.created_at) as first_unread
      from public.chat_messages m
     where m.thread_id = t.id
       and m.kind = 'text'
       and m.author_role in ('rep', 'admin')
       and m.redacted_at is null
       and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)
  ) s
  where t.kind = 'merchant'
    and a.user_id is not null
    and p.email is not null
    and s.first_unread is not null
    and s.first_unread < now() - interval '15 minutes'
    and (cr.last_nudged_at is null
         or (cr.last_nudged_at < now() - interval '4 hours' and cr.last_nudged_at < s.first_unread))
  order by s.first_unread
  limit 50;
$$;
revoke all on function public.chat_nudges_due() from public, anon, authenticated;
grant execute on function public.chat_nudges_due() to service_role;

create or replace function public.chat_mark_nudged(_thread uuid, _user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_reads (thread_id, user_id, last_read_at, last_nudged_at)
  values (_thread, _user, null, now())
  on conflict (thread_id, user_id) do update set last_nudged_at = excluded.last_nudged_at;
$$;
revoke all on function public.chat_mark_nudged(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_mark_nudged(uuid, uuid) to service_role;

/**
 * Asks the site to send any due nudges: POST /api/chat/nudge with the relay secret from the Vault,
 * like notifications_to_team. Nothing calls it until 20261109150000_chat_nudge_schedule.sql runs.
 */
create or replace function public.chat_nudge_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  begin
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'team_relay_url'$q$ into v_url;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'team_relay_secret'$q$ into v_secret;
  exception when others then
    return;
  end;
  if v_url is null or v_secret is null or v_url !~ '/api/team/relay$' then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using regexp_replace(v_url, '/api/team/relay$', '/api/chat/nudge'),
          jsonb_build_object('Content-Type', 'application/json', 'x-team-relay-secret', v_secret),
          '{}'::jsonb;
exception when others then
  return;
end;
$$;
revoke all on function public.chat_nudge_tick() from public, anon, authenticated;

select public.ensure_staff_rooms();

select public.announce(
  'New: Messages tab',
  'Staff > Messages lists every conversation you''re in: your merchants, the All staff room, your team''s room, and direct messages to anyone on staff. Admins can read every conversation and make rooms.',
  '/staff?view=messages', 'all');

notify pgrst, 'reload schema';

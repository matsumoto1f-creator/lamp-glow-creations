-- Messages between a merchant and Lamp, one thread per file (phase 1 of the in-app chat; map:
-- https://claude.ai/artifact/AuVfw94YW7pUFkv5qBF78x).
--
--   chat_threads    one per file (kind 'merchant'), made on first use by open_file_thread()
--   chat_messages   the thread's messages: kept as written, never edited; an admin can redact one
--   chat_reads      when each person last read each thread (unread counts, later the email nudge)
--
-- Who may read and write a file's thread is worked out from the file every time, never stored, so
-- moving a file to another rep moves the thread with it:
--   * the merchant who owns the file (applications.user_id);
--   * the rep the file is assigned to (applications.rep_slug), while they hold a staff role;
--   * that rep's team lead (reps.admin_slug), the person the application emails already name;
--   * admins.
-- An unassigned file's thread is for admins only: reps don't answer from the shared pool until one
-- takes the file. Merchants read nothing but their own file's thread.
--
-- The database refuses, whatever the browser sends:
--   * a message with a Social Security, EIN, card or account-length number in it (8 or more digits
--     in a row): those go through the secure application, never chat;
--   * a message the browser marks as anything but plain text, or as written by someone else
--     (only thread_id and body may be set; the author, role, name and time are stamped here);
--   * more than 20 messages a minute from one person;
--   * any edit or delete from a browser; an admin can redact a message (redact_message()), which
--     keeps the row and who removed it and why.
-- Files never travel through chat: when a merchant uploads a document to a file whose thread
-- exists, a line saying what kind of document arrived is added, pointing at the documents row.
--
-- A merchant's message tells the file's rep and their team lead (an unassigned file: every admin)
-- through the bell, once per thread until they read it; the existing notifications_to_team trigger
-- then sends it as a Discord DM. The notification never carries what the merchant wrote.
--
-- Safe to run more than once.

-- ---------- tables ----------

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'merchant' check (kind in ('merchant')),
  application_id uuid references public.applications (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint chat_threads_file_shape check ((kind = 'merchant') = (application_id is not null))
);
create unique index if not exists chat_threads_file_key on public.chat_threads (application_id)
  where application_id is not null;
create index if not exists chat_threads_last_idx on public.chat_threads (last_message_at desc nulls last);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'document', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  author uuid references auth.users (id) on delete set null default auth.uid(),
  author_role text not null default 'system' check (author_role in ('merchant', 'rep', 'admin', 'system')),
  author_name text check (author_name is null or char_length(author_name) <= 120),
  document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  redacted_at timestamptz,
  redacted_by uuid references auth.users (id) on delete set null,
  redact_reason text check (redact_reason is null or char_length(redact_reason) <= 300)
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at desc);
create index if not exists chat_messages_author_idx on public.chat_messages (author, created_at desc);

create table if not exists public.chat_reads (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_nudged_at timestamptz,
  primary key (thread_id, user_id)
);
create index if not exists chat_reads_user_idx on public.chat_reads (user_id);

-- ---------- who may read a file's thread ----------

/** Is this person the file's merchant, its rep, that rep's team lead, or an admin? */
create or replace function public.chat_can_use_file(_application_id uuid, _user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user is not null and exists (
    select 1 from public.applications a
    where a.id = _application_id
      and (
        a.user_id = _user
        or public.has_role('admin', _user)
        or (
          a.rep_slug is not null
          and public.is_staff(_user)
          and (
            a.rep_slug = public.current_rep_slug(_user)
            or exists (
              select 1 from public.reps r
              where r.slug = a.rep_slug
                and r.admin_slug is not null
                and r.admin_slug = public.current_rep_slug(_user)
            )
          )
        )
      )
  );
$$;
revoke all on function public.chat_can_use_file(uuid, uuid) from public, anon;
grant execute on function public.chat_can_use_file(uuid, uuid) to authenticated, service_role;

create or replace function public.chat_can_read(_thread uuid, _user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_threads t
    where t.id = _thread
      and t.kind = 'merchant'
      and public.chat_can_use_file(t.application_id, _user)
  );
$$;
revoke all on function public.chat_can_read(uuid, uuid) from public, anon;
grant execute on function public.chat_can_read(uuid, uuid) to authenticated, service_role;

-- ---------- what a message may say ----------

/**
 * True when the text carries a number that belongs in the secure application, not chat: a Social
 * Security number (3-2-4 with dashes or spaces), an EIN (2-7), a card number (4-4-4-x), or 8 or
 * more digits in a row (account and routing numbers, an SSN typed without dashes). A phone number
 * written like 201-555-0123 or (201) 555-0123 passes. src/lib/chat.ts holds the same test.
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
alter table public.chat_reads enable row level security;

revoke all on public.chat_threads from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on public.chat_reads from anon, authenticated;
grant select on public.chat_threads to authenticated;
grant select on public.chat_messages to authenticated;
-- only the thread and the words: everything else is stamped by chat_messages_before
grant insert (thread_id, body) on public.chat_messages to authenticated;
grant select on public.chat_reads to authenticated;
grant all on public.chat_threads, public.chat_messages, public.chat_reads to service_role;

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
    and document_id is null
    and public.chat_can_read(thread_id)
  );

drop policy if exists "People read their own read marks" on public.chat_reads;
create policy "People read their own read marks" on public.chat_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- stamping a message ----------

/**
 * Who is writing in this thread, as the thread shows them: ('merchant' | 'rep' | 'admin', name).
 * Also refuses a person sending more than 20 messages a minute. Called by chat_messages_before.
 */
create or replace function public.chat_author_stamp(_thread uuid)
returns table (author_role text, author_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
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

  select ap.* into a
    from public.chat_threads t join public.applications ap on ap.id = t.application_id
   where t.id = _thread;
  if a.id is null then
    raise exception 'That conversation isn''t there.' using errcode = '22023';
  end if;

  if a.user_id = me then
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
revoke all on function public.chat_author_stamp(uuid) from public, anon;
grant execute on function public.chat_author_stamp(uuid) to authenticated;

-- Runs as the caller (not security definer) so it can tell a browser's insert, made as
-- "authenticated", from Lamp's own lines, written by the security definer functions below.
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
  new.document_id := null;
  new.created_at := now();
  new.redacted_at := null;
  new.redacted_by := null;
  new.redact_reason := null;
  new.body := btrim(new.body);

  if public.chat_text_refused(new.body) then
    raise exception 'Please don''t send account, card or Social Security numbers in chat. Your rep will send you a secure link for those. Phone numbers are fine written like 201-555-0123.'
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

-- ---------- after a message: the thread's clock, and who to tell ----------

create or replace function public.chat_messages_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications;
  biz text;
  who text;
  title text;
  body text;
  link text;
  u uuid;
  recipients uuid[] := '{}';
  pair record;
begin
  update public.chat_threads set last_message_at = new.created_at
   where id = new.thread_id and (last_message_at is null or last_message_at < new.created_at);

  -- Only words people type ping anyone. A document line doesn't: the "New document" alert
  -- (notifications_on_document) already tells the rep.
  if new.kind <> 'text' then return new; end if;

  select ap.* into a
    from public.chat_threads t join public.applications ap on ap.id = t.application_id
   where t.id = new.thread_id;
  if a.id is null then return new; end if;

  biz := coalesce(nullif(a.business_name, ''), nullif(a.first_name, ''), 'a file');
  link := '/staff?file=' || a.id;

  if a.rep_slug is not null then
    select * into pair from public.rep_and_lead_users(a.rep_slug);
    recipients := array_remove(array[pair.rep_user, pair.lead_user], null);
  elsif new.author_role = 'merchant' then
    -- an unassigned file: admins answer
    select coalesce(array_agg(distinct ur.user_id), '{}') into recipients
      from public.user_roles ur where ur.role = 'admin';
  end if;

  if new.author_role = 'merchant' then
    who := coalesce(nullif(new.author_name, ''), 'The merchant');
    title := 'Message from ' || who || ' at ' || biz;
    body := null; -- never what the merchant wrote: this also goes to Discord
  else
    title := 'New message on ' || biz;
    body := coalesce(new.author_name, 'Lamp') || ' wrote to the merchant.';
  end if;

  foreach u in array recipients loop
    continue when u is not distinct from new.author;
    -- once per thread until they've read it
    continue when exists (
      select 1 from public.notifications n
       where n.user_id = u and n.kind = 'message' and n.application_id = a.id and n.read_at is null);
    perform public.notify(u, 'message', title, body, link, a.id);
  end loop;
  return new;
end;
$$;
revoke all on function public.chat_messages_after() from public, anon, authenticated;

drop trigger if exists chat_messages_after on public.chat_messages;
create trigger chat_messages_after
  after insert on public.chat_messages
  for each row execute function public.chat_messages_after();

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('file', 'assigned', 'document', 'offer', 'funded', 'started', 'announcement', 'call', 'note', 'message'));

-- ---------- functions the pages call ----------

/** The file's thread, made on first use. For the file's merchant, rep, team lead or an admin. */
create or replace function public.open_file_thread(_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  if not public.chat_can_use_file(_application_id) then
    raise exception 'Not your file.' using errcode = '42501';
  end if;
  select id into t from public.chat_threads where application_id = _application_id;
  if t is null then
    insert into public.chat_threads (kind, application_id, created_by)
    values ('merchant', _application_id, auth.uid())
    on conflict (application_id) where application_id is not null do nothing
    returning id into t;
    if t is null then
      select id into t from public.chat_threads where application_id = _application_id;
    end if;
  end if;
  return t;
end;
$$;
revoke all on function public.open_file_thread(uuid) from public, anon;
grant execute on function public.open_file_thread(uuid) to authenticated;

/** Marks a thread read for the caller (unread counts; the email nudge waits on it). */
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
  -- reading the thread answers its bell item too
  update public.notifications n set read_at = now()
   where n.user_id = auth.uid() and n.kind = 'message' and n.read_at is null
     and n.application_id = (select application_id from public.chat_threads where id = _thread);
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

-- ---------- a document line when a file arrives ----------

create or replace function public.chat_on_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  a public.applications;
  label text;
begin
  begin
    select id into t from public.chat_threads where application_id = new.application_id;
    if t is null then return new; end if; -- no conversation yet: nothing to add to
    select * into a from public.applications where id = new.application_id;
    -- the kind only, never the file's name (a name can hold anything)
    label := case new.kind::text
      when 'bank_statement' then 'a business bank statement'
      when 'voided_check' then 'a voided business check or bank letter'
      when 'drivers_license' then 'a driver''s license'
      when 'funder_application' then 'a signed funder application'
      else 'a document' end;
    insert into public.chat_messages (thread_id, kind, body, author, author_role, author_name, document_id)
    values (
      t, 'document',
      case when new.user_id = a.user_id then 'Sent ' else 'Lamp added ' end || label || '.',
      new.user_id,
      case when new.user_id = a.user_id then 'merchant' else 'system' end,
      case when new.user_id = a.user_id then coalesce(nullif(btrim(a.first_name), ''), 'Merchant') else 'Lamp' end,
      new.id);
  exception when others then
    null; -- an upload never fails because of chat
  end;
  return new;
end;
$$;
revoke all on function public.chat_on_document() from public, anon, authenticated;

drop trigger if exists chat_on_document on public.documents;
create trigger chat_on_document
  after insert on public.documents
  for each row execute function public.chat_on_document();

select public.announce(
  'New: messages with merchants',
  'Each file now has a conversation with its merchant: on their account page, and on the file under "Messages with the merchant". The merchant sees everything there; Notes & calls stay team-only. You get a bell (and a Discord DM) when a merchant writes.',
  null, 'all');

notify pgrst, 'reload schema';

-- Messages with the merchant, one conversation per file (second part of the in-app chat; map:
-- https://claude.ai/artifact/AuVfw94YW7pUFkv5qBF78x). Runs after 20261110120000_chat_staff.sql.
--
-- The merchant writes from their account page; the file's rep, that rep's team lead and admins
-- answer from the file view and from Staff > Messages. Who may read and write a file's conversation
-- is worked out from the file every time, never stored, so moving a file to another rep moves the
-- conversation with it:
--   * the merchant who owns the file (applications.user_id);
--   * the rep the file is assigned to (applications.rep_slug), while they hold a staff role;
--   * that rep's team lead (reps.admin_slug), the person the application emails already name;
--   * admins.
-- An unassigned file's conversation is for admins only: reps don't answer from the shared pool until
-- one takes the file. Merchants read nothing but their own file's conversation.
--
-- The same guard as the staff chat applies (no SSN, EIN, card or account numbers; no edits; admins
-- redact). Files never travel through chat: when a merchant uploads a document to a file whose
-- conversation exists, a line naming the document's kind (never its file name) is added, pointing
-- at the documents row.
--
-- Nothing leaves Lamp for staff: a merchant's message shows as unread in Staff > Messages for the
-- file's rep and team lead (admins: unassigned files and conversations they've opened) and in the
-- count under the bell. No notifications rows, so nothing reaches Discord.
-- The merchant hears by email when a Lamp reply has waited 15 minutes unread, at most once every 4
-- hours per conversation: chat_nudges_due() and chat_mark_nudged() feed POST /api/chat/nudge, which
-- sends a link to their account and never the message. Its address and secret are this file's own
-- Vault entries (chat_nudge_url, chat_nudge_secret); the 5-minute schedule is a separate file,
-- 20261110150000_chat_nudge_schedule.sql. Safe to run more than once.

-- ---------- a third kind of conversation ----------

alter table public.chat_threads add column if not exists application_id uuid
  references public.applications (id) on delete cascade;
alter table public.chat_threads drop constraint if exists chat_threads_kind_check;
alter table public.chat_threads add constraint chat_threads_kind_check
  check (kind in ('room', 'direct', 'merchant'));
alter table public.chat_threads drop constraint if exists chat_threads_file_shape;
alter table public.chat_threads add constraint chat_threads_file_shape
  check ((kind = 'merchant') = (application_id is not null));
create unique index if not exists chat_threads_file_key on public.chat_threads (application_id)
  where application_id is not null;

alter table public.chat_messages add column if not exists document_id uuid
  references public.documents (id) on delete set null;
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check
  check (kind in ('text', 'document', 'system'));
alter table public.chat_messages drop constraint if exists chat_messages_author_role_check;
alter table public.chat_messages add constraint chat_messages_author_role_check
  check (author_role in ('merchant', 'rep', 'admin', 'system'));

alter table public.chat_reads add column if not exists last_nudged_at timestamptz;

-- ---------- who may read and write a file's conversation ----------

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
  select _user is not null and exists (
    select 1 from public.chat_threads t
    where t.id = _thread
      and case
        when t.kind = 'merchant' then public.chat_can_use_file(t.application_id, _user)
        else public.is_staff(_user) and (
          public.has_role('admin', _user)
          or t.audience = 'all'
          or (t.audience = 'team' and (
                public.current_rep_slug(_user) = t.team_slug
                or exists (select 1 from public.reps r
                           where r.user_id = _user and r.active and r.admin_slug = t.team_slug)))
          or exists (select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = _user)
        )
      end
  );
$$;

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

drop policy if exists "People write in their threads" on public.chat_messages;
create policy "People write in their threads" on public.chat_messages
  for insert to authenticated
  with check (
    kind = 'text'
    and author = (select auth.uid())
    and document_id is null
    and public.chat_can_post(thread_id)
  );

-- ---------- stamping: the merchant is named as the file names them ----------

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
    raise exception 'Please don''t send account, card or Social Security numbers in chat; Lamp collects those through the secure application. Phone numbers are fine written like 201-555-0123.'
      using errcode = '22023';
  end if;
  select * into s from public.chat_author_stamp(new.thread_id);
  new.author_role := s.author_role;
  new.author_name := s.author_name;
  return new;
end;
$$;

-- ---------- functions the pages call ----------

/** The file's conversation, made on first use. For the file's merchant, rep, team lead or an admin. */
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

/**
 * Staff > Messages, now with merchants: the file's rep and team lead see its conversation once it
 * has a message; an admin sees unassigned files' conversations and ones they've opened (they reach
 * any file's from the file view). The rest as before.
 */
drop function if exists public.my_chat_inbox();
create function public.my_chat_inbox()
returns table (
  thread_id uuid,
  kind text,
  title text,
  subtitle text,
  preview text,
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
    case
      when t.kind = 'merchant' then
        coalesce((select r.name from public.reps r where r.slug = a.rep_slug), 'Unassigned')
      when t.kind = 'direct' then 'Direct message'
      when t.audience = 'all' then 'Everyone on staff'
      when t.audience = 'team' then 'Team room'
      else 'Room'
    end,
    (select case when char_length(lm.body) > 120 then left(lm.body, 119) || '…' else lm.body end
       from public.chat_messages lm where lm.thread_id = t.id
      order by lm.created_at desc, lm.id desc limit 1),
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
    and (t.kind <> 'direct' or exists (
          select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = auth.uid()))
    and (t.audience is distinct from 'members' or exists (
          select 1 from public.chat_members m where m.thread_id = t.id and m.user_id = auth.uid()))
    and (t.kind <> 'merchant' or (
          t.last_message_at is not null
          and (
            (a.rep_slug is not null and (
               a.rep_slug = public.current_rep_slug()
               or exists (select 1 from public.reps r where r.slug = a.rep_slug
                            and r.admin_slug = public.current_rep_slug())))
            or (public.has_role('admin') and (
               a.rep_slug is null
               or exists (select 1 from public.chat_reads cr where cr.thread_id = t.id and cr.user_id = auth.uid())))
          )))
    and public.chat_can_read(t.id)
  order by t.last_message_at desc nulls last, t.created_at desc
  limit 300;
$$;
revoke all on function public.my_chat_inbox() from public, anon;
grant execute on function public.my_chat_inbox() to authenticated;

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

-- ---------- the merchant email nudge (server only) ----------

/**
 * Merchants to email: a staff message in their file's conversation has waited unread for 15 minutes,
 * and they haven't been nudged about this conversation in 4 hours (or since that message).
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

-- The nudge's own address and secret in the Vault (nothing shared with any other integration).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'chat_nudge_url') then
    perform vault.create_secret('https://getlamp.app/api/chat/nudge', 'chat_nudge_url',
      'Where the database asks the site to send merchant email nudges');
  end if;
  if not exists (select 1 from vault.secrets where name = 'chat_nudge_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'chat_nudge_secret',
      'Shared by chat_nudge_tick() and /api/chat/nudge; read by the site via chat_nudge_secret()');
  end if;
exception when others then
  raise notice 'No Vault here; the nudge stays off.';
end;
$$;

/** The nudge secret, for the site's server only. */
create or replace function public.chat_nudge_secret()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'chat_nudge_secret';
$$;
revoke all on function public.chat_nudge_secret() from public, anon, authenticated;
grant execute on function public.chat_nudge_secret() to service_role;

/** Asks the site to send any due nudges. Nothing calls it until the schedule file runs. */
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
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'chat_nudge_url'$q$ into v_url;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'chat_nudge_secret'$q$ into v_secret;
  exception when others then
    return;
  end;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using v_url,
          jsonb_build_object('Content-Type', 'application/json', 'x-chat-nudge-secret', v_secret),
          '{}'::jsonb;
exception when others then
  return;
end;
$$;
revoke all on function public.chat_nudge_tick() from public, anon, authenticated;

notify pgrst, 'reload schema';

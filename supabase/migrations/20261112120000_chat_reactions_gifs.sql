-- Chat: emoji reactions on messages, and GIFs in staff conversations.
--
-- 1. chat_reactions: who put which emoji on which message. Anyone who can read a conversation
--    sees its reactions; anyone who can write in it can add their own and take their own off.
--    At most 6 different emojis from one person on one message.
-- 2. GIFs: a new message kind, 'gif', whose body is the address of a GIF on KLIPY's media
--    servers. Staff rooms and direct messages only: a GIF can never be sent into a merchant's
--    conversation. A GIF's address is long and full of digits, so it is checked by its own rule
--    (chat_gif_url_ok) instead of the rule that refuses account numbers in text.
-- 3. chat_settings: one row holding Lamp's KLIPY app key. KLIPY requires searches to be sent from
--    the person's own browser, so the key is not a secret from staff: staff read it, admins set it.
--
-- Safe to run more than once. Existing messages are not changed.

-- ------------------------------------------------------------------ 1. reactions
create table if not exists public.chat_reactions (
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- an emoji, never text or markup
  emoji text not null check (
    char_length(emoji) between 1 and 16 and emoji !~ '[[:alnum:][:space:]<>&"'']'
  ),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_reactions_message_idx on public.chat_reactions (message_id);

alter table public.chat_reactions enable row level security;
revoke all on public.chat_reactions from anon, authenticated;
grant select, insert, delete on public.chat_reactions to authenticated;
grant all on public.chat_reactions to service_role;

drop policy if exists "People see reactions in their threads" on public.chat_reactions;
create policy "People see reactions in their threads" on public.chat_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = chat_reactions.message_id and public.chat_can_read(m.thread_id)
    )
  );

drop policy if exists "People react in threads they can write in" on public.chat_reactions;
create policy "People react in threads they can write in" on public.chat_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.chat_messages m
      where m.id = chat_reactions.message_id
        and m.redacted_at is null
        and m.kind in ('text', 'gif')
        and public.chat_can_post(m.thread_id)
    )
  );

drop policy if exists "People take their own reactions off" on public.chat_reactions;
create policy "People take their own reactions off" on public.chat_reactions
  for delete to authenticated
  using (user_id = auth.uid());

/** One person, one message: at most 6 different emojis. */
create or replace function public.chat_reactions_before()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.user_id := auth.uid();
    new.created_at := now();
    if (select count(*) from public.chat_reactions r
        where r.message_id = new.message_id and r.user_id = new.user_id) >= 6 then
      raise exception 'That''s enough reactions on one message.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists chat_reactions_before on public.chat_reactions;
create trigger chat_reactions_before
  before insert on public.chat_reactions
  for each row execute function public.chat_reactions_before();

-- Reactions arrive at once, like messages (same pattern as 20261110130000_chat_realtime.sql).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here; reactions show on the next look.';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_reactions';
  end if;
end;
$$;

-- ------------------------------------------------------------------ 2. GIFs
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check
  check (kind in ('text', 'document', 'system', 'gif'));

-- The browser may now say what kind a new message is. chat_messages_before() below decides what it
-- really is: 'gif' only for a KLIPY address in a staff conversation, 'text' for everything else,
-- whatever was asked for.
grant insert (kind) on public.chat_messages to authenticated;

/** True for the address of a GIF (or its WebP twin) on KLIPY's media servers, and nothing else. */
create or replace function public.chat_gif_url_ok(_url text)
returns boolean
language sql
immutable
as $$
  select _url is not null
    and char_length(_url) <= 500
    and _url ~ '^https://static[12]?\.klipy\.com/[A-Za-z0-9/_.-]{8,250}\.(gif|webp)(\?[A-Za-z0-9=&_.%-]{1,150})?$'
    and _url !~ '\.\.'
    and _url !~ '//[^/]*//';
$$;

/**
 * Stamps every message a person sends. As before, except that a message asked for as a GIF stays
 * a GIF when it is a KLIPY address in a staff room or direct message; anything else is text and
 * goes through the same checks as always.
 */
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
  new.author := me;
  new.document_id := null;
  new.created_at := now();
  new.redacted_at := null;
  new.redacted_by := null;
  new.redact_reason := null;
  new.body := btrim(new.body);
  if new.kind = 'gif' then
    if not public.chat_gif_url_ok(new.body) then
      raise exception 'That isn''t a GIF Lamp can show.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.chat_threads t
      where t.id = new.thread_id and t.kind in ('room', 'direct')
    ) then
      raise exception 'GIFs are for staff conversations only.' using errcode = '22023';
    end if;
  else
    new.kind := 'text';
    if public.chat_text_refused(new.body) then
      raise exception 'Please don''t send account, card or Social Security numbers in chat; Lamp collects those through the secure application. Phone numbers are fine written like 201-555-0123.'
        using errcode = '22023';
    end if;
  end if;
  select * into s from public.chat_author_stamp(new.thread_id);
  new.author_role := s.author_role;
  new.author_name := s.author_name;
  return new;
end;
$$;

-- The write rule accepted text only. It now also accepts a GIF, checked a second time here: the
-- trigger above has already turned anything that isn't a real GIF into text before this runs.
drop policy if exists "People write in their threads" on public.chat_messages;
create policy "People write in their threads" on public.chat_messages
  for insert to authenticated
  with check (
    (kind = 'text' or (kind = 'gif' and public.chat_gif_url_ok(body)))
    and author = (select auth.uid())
    and document_id is null
    and public.chat_can_post(thread_id)
  );

-- ------------------------------------------------------------------ 3. the KLIPY app key
create table if not exists public.chat_settings (
  id boolean primary key default true check (id),
  klipy_app_key text check (klipy_app_key is null or klipy_app_key ~ '^[A-Za-z0-9._~-]{8,200}$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.chat_settings (id) values (true) on conflict (id) do nothing;

alter table public.chat_settings enable row level security;
revoke all on public.chat_settings from anon, authenticated;
grant select, update on public.chat_settings to authenticated;
grant all on public.chat_settings to service_role;

drop policy if exists "Staff read chat settings" on public.chat_settings;
create policy "Staff read chat settings" on public.chat_settings
  for select to authenticated
  using (public.is_staff());

drop policy if exists "Admins change chat settings" on public.chat_settings;
create policy "Admins change chat settings" on public.chat_settings
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

/** Who changed the settings, and when. */
create or replace function public.chat_settings_before()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := true;
  new.updated_at := now();
  if current_user in ('authenticated', 'anon') then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists chat_settings_before on public.chat_settings;
create trigger chat_settings_before
  before update on public.chat_settings
  for each row execute function public.chat_settings_before();

-- Private lists (Asad, 2026-11-10).
--
-- A staff member's own prospect lists: businesses they plan to call or email, kept apart from
-- Engine leads and from files.
--   * a list, its entries and its log belong to the person who made them (owner = auth.uid());
--   * only the owner reads or changes them. Being an admin opens nothing here: these are the
--     only staff tables where has_role('admin') is not a way in;
--   * the owner has to be staff, so someone who leaves the team loses their lists' screen;
--   * merchants and signed-out visitors read and write nothing;
--   * the log (private_list_touches) is one row per email, call, reply or note. A row is never
--     rewritten; the owner can remove one logged by mistake.
-- What this does not hide: whoever holds the database itself (the service role, the SQL editor)
-- reads every table, as with all data here. "Private" means private in the app and its API.
--
-- Nothing existing is changed or re-created. Run once in the SQL editor; running it again is safe.

-- ---------- lists ----------
create table if not exists public.private_lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create unique index if not exists private_lists_owner_name_idx
  on public.private_lists (owner, lower(btrim(name)));

-- ---------- entries: one business on a list ----------
create table if not exists public.private_list_entries (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.private_lists (id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  business text not null check (char_length(btrim(business)) between 1 and 200),
  contact text check (contact is null or char_length(contact) <= 200),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 200),
  website text check (website is null or char_length(website) <= 300),
  area text check (area is null or char_length(area) <= 200),
  grp text check (grp is null or char_length(grp) <= 80),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'new'
    check (status in ('new', 'emailed', 'called', 'replied', 'talking', 'won', 'dead')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists private_list_entries_list_idx
  on public.private_list_entries (list_id, position, business);
create unique index if not exists private_list_entries_business_idx
  on public.private_list_entries (list_id, lower(btrim(business)));

drop trigger if exists private_list_entries_updated_at on public.private_list_entries;
create trigger private_list_entries_updated_at
  before update on public.private_list_entries
  for each row execute function public.update_updated_at_column();

-- ---------- the log: one row per email, call, reply or note ----------
create table if not exists public.private_list_touches (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.private_list_entries (id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('email', 'call', 'reply', 'note')),
  happened_at timestamptz not null default now(),
  detail text check (detail is null or char_length(detail) <= 2000),
  to_address text check (to_address is null or char_length(to_address) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists private_list_touches_entry_idx
  on public.private_list_touches (entry_id, happened_at desc);

-- ---------- who may do what: the owner, and no one else ----------
alter table public.private_lists enable row level security;
alter table public.private_list_entries enable row level security;
alter table public.private_list_touches enable row level security;

revoke all on public.private_lists from anon, authenticated;
revoke all on public.private_list_entries from anon, authenticated;
revoke all on public.private_list_touches from anon, authenticated;

-- owner, id and created_at are never in an update grant, so a row can't be handed to someone else
grant select, insert, delete on public.private_lists to authenticated;
grant update (name, note) on public.private_lists to authenticated;
grant select, insert, delete on public.private_list_entries to authenticated;
grant update (business, contact, phone, email, website, area, grp, notes, status, position)
  on public.private_list_entries to authenticated;
grant select, insert, delete on public.private_list_touches to authenticated;

grant all on public.private_lists to service_role;
grant all on public.private_list_entries to service_role;
grant all on public.private_list_touches to service_role;

drop policy if exists "Owner reads own lists" on public.private_lists;
create policy "Owner reads own lists" on public.private_lists
  for select to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()));

drop policy if exists "Owner adds own lists" on public.private_lists;
create policy "Owner adds own lists" on public.private_lists
  for insert to authenticated
  with check (owner = (select auth.uid()) and (select public.is_staff()));

drop policy if exists "Owner changes own lists" on public.private_lists;
create policy "Owner changes own lists" on public.private_lists
  for update to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()))
  with check (owner = (select auth.uid()) and (select public.is_staff()));

drop policy if exists "Owner removes own lists" on public.private_lists;
create policy "Owner removes own lists" on public.private_lists
  for delete to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()));

drop policy if exists "Owner reads own list entries" on public.private_list_entries;
create policy "Owner reads own list entries" on public.private_list_entries
  for select to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()));

-- an entry can only be put on a list its owner also owns
drop policy if exists "Owner adds own list entries" on public.private_list_entries;
create policy "Owner adds own list entries" on public.private_list_entries
  for insert to authenticated
  with check (
    owner = (select auth.uid())
    and (select public.is_staff())
    and exists (
      select 1 from public.private_lists l
      where l.id = list_id and l.owner = (select auth.uid())
    )
  );

drop policy if exists "Owner changes own list entries" on public.private_list_entries;
create policy "Owner changes own list entries" on public.private_list_entries
  for update to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()))
  with check (owner = (select auth.uid()) and (select public.is_staff()));

drop policy if exists "Owner removes own list entries" on public.private_list_entries;
create policy "Owner removes own list entries" on public.private_list_entries
  for delete to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()));

drop policy if exists "Owner reads own list log" on public.private_list_touches;
create policy "Owner reads own list log" on public.private_list_touches
  for select to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()));

-- a log row can only hang on an entry its owner also owns
drop policy if exists "Owner adds to own list log" on public.private_list_touches;
create policy "Owner adds to own list log" on public.private_list_touches
  for insert to authenticated
  with check (
    owner = (select auth.uid())
    and (select public.is_staff())
    and exists (
      select 1 from public.private_list_entries e
      where e.id = entry_id and e.owner = (select auth.uid())
    )
  );

drop policy if exists "Owner removes from own list log" on public.private_list_touches;
create policy "Owner removes from own list log" on public.private_list_touches
  for delete to authenticated
  using (owner = (select auth.uid()) and (select public.is_staff()));

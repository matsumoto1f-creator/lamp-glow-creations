-- Application links: what the merchant did, kept apart from what the rep did (Asad, 2026-11-25:
-- "if i seen they opened/started the application how true is this signal", then "Yes, fix it").
-- Until now a link showed Opened and Started whenever anyone loaded it or typed in it, the rep's
-- own Start application on the call included (GAUDIOSO CONTRACTING showed Started for that
-- reason), and only the first time was kept.
--
-- New, on application_invites:
--   rep_filled_at            when a rep first saved answers on it on the call
--   merchant_opened_at       first time the merchant's browser opened it
--   merchant_last_opened_at  the latest time
--   merchant_open_count      how many times it was opened
--   merchant_started_at      first answer the merchant typed themselves
--   merchant_device          phone, tablet or computer, from the browser (nothing else is kept)
-- A signed-in staff member opening a link, and link scanners, are not counted (the server
-- decides; see openApplication). No IP address is kept.
--
-- History: links no rep filled in keep their old stamps as the merchant's (that is who opened
-- them, scanners and staff checks aside). Links a rep filled in start with no merchant opens on
-- record, because the old stamps can't say who it was.
-- Run once in the SQL editor; running it again is safe. The site works before it is run.

alter table public.application_invites
  add column if not exists rep_filled_at timestamptz,
  add column if not exists merchant_opened_at timestamptz,
  add column if not exists merchant_last_opened_at timestamptz,
  add column if not exists merchant_open_count integer not null default 0,
  add column if not exists merchant_started_at timestamptz,
  add column if not exists merchant_device text;

alter table public.application_invites drop constraint if exists application_invites_merchant_device_ok;
alter table public.application_invites add constraint application_invites_merchant_device_ok
  check (merchant_device is null or merchant_device in ('phone', 'tablet', 'computer'));

-- backfill, once: a column still at its defaults everywhere means it was just added
do $$
begin
  if not exists (select 1 from public.application_invites
                 where rep_filled_at is not null or merchant_opened_at is not null
                    or merchant_open_count <> 0) then
    update public.application_invites
       set rep_filled_at = least(started_at, draft_saved_at)
     where draft_by is not null;
    update public.application_invites
       set merchant_opened_at = opened_at,
           merchant_last_opened_at = opened_at,
           merchant_open_count = case when opened_at is not null then 1 else 0 end,
           merchant_started_at = started_at
     where draft_by is null;
  end if;
end;
$$;

-- a rep's first save of answers stamps rep_filled_at
create or replace function public.application_invites_rep_filled()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.draft_by is not null and new.rep_filled_at is null then
    new.rep_filled_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.application_invites_rep_filled() from public, anon, authenticated;
drop trigger if exists application_invites_rep_filled on public.application_invites;
create trigger application_invites_rep_filled
  before update on public.application_invites
  for each row execute function public.application_invites_rep_filled();

-- the merchant's browser opened the link (or typed the first answer, _started); the server calls
-- this with its own key after deciding the visit is the merchant's
create or replace function public.note_merchant_open(_invite uuid, _device text, _started boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.application_invites
     set merchant_opened_at = coalesce(merchant_opened_at, now()),
         merchant_last_opened_at = case when _started then coalesce(merchant_last_opened_at, now())
                                        else now() end,
         merchant_open_count = merchant_open_count + case when _started then 0 else 1 end,
         merchant_started_at = case when _started then coalesce(merchant_started_at, now())
                                    else merchant_started_at end,
         merchant_device = case when _device in ('phone', 'tablet', 'computer') then _device
                                else merchant_device end
   where id = _invite and submitted_at is null;
$$;
revoke all on function public.note_merchant_open(uuid, text, boolean) from public, anon, authenticated;

-- read-only summary: counts only
select
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'application_invites' and column_name = 'merchant_open_count') as columns_present,
  (select count(*) from public.application_invites where rep_filled_at is not null) as links_a_rep_filled,
  (select count(*) from public.application_invites where merchant_opened_at is not null) as links_the_merchant_opened,
  exists (select 1 from pg_proc where proname = 'note_merchant_open') as function_present;

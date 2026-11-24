-- Engine leads: when to call back (Asad, 2026-11-24: "i also want there to be a scheduler for the
-- call back disposition option in the portal when i open the lead ... so i know what to do
-- throughout my day").
-- A rep who sets a lead to Callback can now pick the day and time. The calendar puts the
-- "Call back ..." item at that time instead of on the next business day.
-- A day with no time is stored as midnight New York time and shown as an all-day item.
-- The time is dropped when the lead leaves Callback, so an old time never comes back later.
-- Staff edit it under the same row rules as status and notes; the engine's push never sends it.
-- Run once in the SQL editor; running it again is safe. The site works before it is run.

alter table public.engine_leads add column if not exists callback_at timestamptz;

create or replace function public.engine_leads_callback_clear()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from 'callback' then
    new.callback_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.engine_leads_callback_clear() from public, anon;

drop trigger if exists engine_leads_callback_clear on public.engine_leads;
create trigger engine_leads_callback_clear
  before insert or update on public.engine_leads
  for each row execute function public.engine_leads_callback_clear();

-- read-only summary: expect both true
select
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'engine_leads' and column_name = 'callback_at') as column_present,
  exists (select 1 from pg_trigger where tgname = 'engine_leads_callback_clear'
          and tgrelid = 'public.engine_leads'::regclass and not tgisinternal) as trigger_present;

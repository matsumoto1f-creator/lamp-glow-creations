-- Engine leads: the contact a rep gets on the call (Asad, 2026-11-05).
-- The engine owns name, phone and email (engine_leads_before_update keeps staff from changing them,
-- and every push upserts them), so what a rep learns lives in its own columns that no push sends:
-- who they spoke to, the email to send the application to, and the best number to reach them.
-- Staff can edit these like status and notes; contact_updated_at stamps the last change.

alter table public.engine_leads
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists contact_updated_at timestamptz;

alter table public.engine_leads drop constraint if exists engine_leads_contact_name_len;
alter table public.engine_leads add constraint engine_leads_contact_name_len
  check (contact_name is null or length(contact_name) <= 120);
alter table public.engine_leads drop constraint if exists engine_leads_contact_email_ok;
alter table public.engine_leads add constraint engine_leads_contact_email_ok
  check (contact_email is null or (length(contact_email) <= 200 and contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'));
alter table public.engine_leads drop constraint if exists engine_leads_contact_phone_ok;
alter table public.engine_leads add constraint engine_leads_contact_phone_ok
  check (contact_phone is null or (length(contact_phone) <= 40 and contact_phone ~ '^[0-9+()\s.x-]+$'));

create or replace function public.engine_leads_contact_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.contact_name, new.contact_email, new.contact_phone)
     is distinct from (old.contact_name, old.contact_email, old.contact_phone) then
    new.contact_updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.engine_leads_contact_stamp() from public, anon;

drop trigger if exists engine_leads_contact_stamp on public.engine_leads;
create trigger engine_leads_contact_stamp
  before update on public.engine_leads
  for each row execute function public.engine_leads_contact_stamp();

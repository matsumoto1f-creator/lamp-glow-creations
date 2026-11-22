-- The engine's best address for a lead's owner, with how sure it is (Asad, 2026-11-20: "put the
-- owner emails on the leads in the portal"; reps cold-call these leads to confirm and validate the
-- information, so the address is shown as something to confirm, not as a fact).
--
-- engine_leads.email already holds the engine's address. Two new columns say where it came from:
--   email_confidence  confirmed (the business filed or printed it, with the owner's name in it),
--                     verified (built from the owner's name and the business's own domain; the mail
--                     server says the mailbox exists), probable (a real mailbox the business gave,
--                     not provably the owner's). Null: the engine has said nothing about it.
--   email_method      one sentence a rep can read: where the address came from.
-- The engine writes them with the server's key (POST /api/engine/push { emails: [...] }); reps and
-- admins read them like the rest of the row. What a rep typed on the lead (contact_email) is never
-- touched. Nothing else changes: no row is rewritten, no rule is added or dropped.
-- Run once in the SQL editor; running it again is safe.

alter table public.engine_leads
  add column if not exists email_confidence text,
  add column if not exists email_method text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'engine_leads_email_confidence_check'
      and conrelid = 'public.engine_leads'::regclass
  ) then
    alter table public.engine_leads
      add constraint engine_leads_email_confidence_check
      check (email_confidence is null or email_confidence in ('confirmed', 'verified', 'probable'));
  end if;
end;
$$;

-- read-only summary for the person running this: expect columns_present 2, check_present true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'engine_leads'
      and column_name in ('email_confidence', 'email_method')) as columns_present,
  exists (
    select 1 from pg_constraint where conname = 'engine_leads_email_confidence_check'
  ) as check_present;

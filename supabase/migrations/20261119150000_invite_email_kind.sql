-- Which email went with an application link (Asad, 2026-11-19). Staff > Send the application now
-- picks the words to match the call: the application as discussed, "not right now: Lamp for
-- later", "wants to see their options first", or "already has an offer". A resend reuses the same
-- words, so someone who heard "no rush" never gets "Your Lamp application" back.
--
-- One nullable column; null means the application email (every link sent before today). The
-- server writes it with the service key, like the rest of the row. Nothing else changes.
-- Run once in the SQL editor; running it again is safe. Until it is run, links still go out with
-- the chosen words, and a resend falls back to the application email.

alter table public.application_invites
  add column if not exists email_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_invites_email_kind_check'
      and conrelid = 'public.application_invites'::regclass
  ) then
    alter table public.application_invites
      add constraint application_invites_email_kind_check
      check (email_kind is null or email_kind in ('apply', 'later', 'options', 'offer'));
  end if;
end;
$$;

-- read-only summary for the person running this: expect column_present true, check_present true
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'application_invites' and column_name = 'email_kind'
  ) as column_present,
  exists (
    select 1 from pg_constraint where conname = 'application_invites_email_kind_check'
  ) as check_present;

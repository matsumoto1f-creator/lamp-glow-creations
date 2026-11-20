-- Two more kinds of email on an application link (Asad, 2026-11-20): "thanks", a thank-you for
-- someone the rep met or spoke with, the owner or not, that says what Lamp is and asks nothing;
-- and "intro", an introduction for the person who decides when the rep reached someone else.
-- The email_kind column's allowed list (20261119150000_invite_email_kind.sql) has to name it, so a
-- resend of that link keeps the same words.
--
-- One statement, so there is no moment without the rule. No row changes: every kind stored today
-- is still allowed. Run once in the SQL editor; running it again is safe. Until it is run, a
-- "thanks" or "intro" email still goes out with its own words, and a resend falls back to the application
-- email.

alter table public.application_invites
  drop constraint if exists application_invites_email_kind_check,
  add constraint application_invites_email_kind_check
    check (
      email_kind is null
      or email_kind in ('apply', 'thanks', 'intro', 'later', 'options', 'offer')
    );

-- read-only summary for the person running this: expect new_kinds_allowed true
select
  exists (
    select 1 from pg_constraint
    where conname = 'application_invites_email_kind_check'
      and conrelid = 'public.application_invites'::regclass
      and pg_get_constraintdef(oid) like '%thanks%'
      and pg_get_constraintdef(oid) like '%intro%'
  ) as new_kinds_allowed;

-- Start application (Asad, 2026-11-05): a rep fills in the merchant's application with them on the
-- phone, then emails the same personal link for the merchant to check and sign. The answers so far
-- live on the invite so the merchant's browser opens them, not only the rep's.
-- Never the SSN or a date of birth: the site's server blanks both before saving, and the merchant
-- types them when they sign. Written and read only by the site's server (service role); staff
-- reading their own invites see the answers they typed.

alter table public.application_invites
  add column if not exists draft jsonb,
  add column if not exists draft_step smallint,
  add column if not exists draft_saved_at timestamptz,
  add column if not exists draft_by uuid references auth.users (id) on delete set null;

alter table public.application_invites drop constraint if exists application_invites_draft_size;
alter table public.application_invites add constraint application_invites_draft_size
  check (draft is null or (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 200000));

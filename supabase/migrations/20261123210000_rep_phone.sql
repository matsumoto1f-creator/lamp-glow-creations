-- A rep's phone number, for the sign-off of the emails Lamp sends in their name (Asad,
-- 2026-11-23: "my phone number should be in there and encourage them to email us directly too").
-- Staff read it with the rest of a rep's row; visitors and merchants do not (their grants on reps
-- name the public columns, see 20261123200000_reps_public_fields.sql, and this is not one).
-- An email from a rep with no number here simply leaves the number out.
-- Asad's is the Google Voice number he calls merchants from.
-- Run once in the SQL editor; running it again is safe. The site works before it is run.

alter table public.reps add column if not exists phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reps_phone_ok' and conrelid = 'public.reps'::regclass
  ) then
    alter table public.reps
      add constraint reps_phone_ok
      check (phone is null or (length(phone) <= 40 and phone ~ '^[0-9+()\s.x-]+$'));
  end if;
end;
$$;

update public.reps set phone = '908-765-8526' where slug = 'asad' and phone is null;

-- read-only summary: expect column_present true, and how many reps have a number
select
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'reps' and column_name = 'phone') as column_present,
  (select count(*) from public.reps where phone is not null) as reps_with_a_number,
  (select count(*) from public.reps where active) as active_reps;

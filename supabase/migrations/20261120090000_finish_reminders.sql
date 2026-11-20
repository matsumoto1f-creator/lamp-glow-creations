-- "Finish your application" reminders (Asad, 2026-11-19, the funnel map he signed off).
--
-- Someone who started an application and left (a rep's public link, the website's application,
-- or a personal link a rep sent) gets one email an hour later and one the next morning, then
-- nothing; never at night (Eastern), never once they have signed, and never after the stop link
-- or a rep's Stop reminders. The rules are in src/lib/finish-reminders.ts; the sending is
-- /api/application/remind on the site.
--
-- This file: what each person has had (three columns on leads and on application_invites), the
-- shared secret the site signs reminder links and stop links with, and finish_remind_tick(), which
-- asks the site to send what's due. Nothing calls the tick until the schedule file runs
-- (20261120090100_finish_reminders_schedule.sql). Safe to run more than once.

alter table public.leads
  add column if not exists reminders_sent int not null default 0,
  add column if not exists reminded_at timestamptz,
  add column if not exists reminders_stopped_at timestamptz;

alter table public.application_invites
  add column if not exists reminders_sent int not null default 0,
  add column if not exists reminded_at timestamptz,
  add column if not exists reminders_stopped_at timestamptz;

-- the job's two lookups: recent unsigned starters on public links, recent started personal links
create index if not exists leads_remind_idx on public.leads (created_at)
  where converted_application_id is null and reminders_stopped_at is null and reminders_sent < 2;
create index if not exists application_invites_remind_idx on public.application_invites (started_at)
  where submitted_at is null and cancelled_at is null and reminders_stopped_at is null
    and reminders_sent < 2 and started_at is not null;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'finish_remind_url') then
    perform vault.create_secret('https://getlamp.app/api/application/remind', 'finish_remind_url',
      'Where the database asks the site to send finish-your-application reminders');
  end if;
  if not exists (select 1 from vault.secrets where name = 'finish_remind_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'finish_remind_secret',
      'Shared by finish_remind_tick() and /api/application/remind; signs reminder and stop links');
  end if;
exception when others then
  raise notice 'No Vault here; reminders stay off.';
end;
$$;

/** The reminder secret, for the site's server only. */
create or replace function public.finish_remind_secret()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'finish_remind_secret';
$$;
revoke all on function public.finish_remind_secret() from public, anon, authenticated;
grant execute on function public.finish_remind_secret() to service_role;

/** Asks the site to send any reminders that are due. Nothing calls it until the schedule file runs. */
create or replace function public.finish_remind_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  begin
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'finish_remind_url'$q$ into v_url;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'finish_remind_secret'$q$ into v_secret;
  exception when others then
    return;
  end;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using v_url,
          jsonb_build_object('Content-Type', 'application/json', 'x-finish-remind-secret', v_secret),
          '{}'::jsonb;
exception when others then
  return;
end;
$$;
revoke all on function public.finish_remind_tick() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- read-only check for the person running this: expect columns 6, secret true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name in ('leads', 'application_invites')
      and column_name in ('reminders_sent', 'reminded_at', 'reminders_stopped_at')) as columns,
  (select count(*) = 1 from vault.secrets where name = 'finish_remind_secret') as secret;

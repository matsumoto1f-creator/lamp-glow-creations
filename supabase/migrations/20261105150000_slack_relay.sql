-- Lamp in Slack (Asad, 2026-11-05; setup in docs/slack.md). Every staff notification the database
-- writes (new file, assigned, document, offer accepted, funded, merchant started a link, the
-- engine's "N new leads for today") is handed to the site, which sends it to that person as a
-- Slack DM and posts deal events to the team channel. The site does nothing until the Lamp app's
-- SLACK_BOT_TOKEN is set, so running this first is safe.
--
-- The relay secret is made here, in Vault, and never leaves the database and the site's server:
-- the trigger sends it as a header and the site reads it back through slack_relay_secret()
-- (service role only). Nobody has to copy it anywhere.

-- 1. Vault: where to send, and the shared secret. Made once; running this again keeps them.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'slack_relay_url') then
    perform vault.create_secret('https://getlamp.app/api/slack/relay', 'slack_relay_url',
      'Where the database hands notifications to Slack (the site route)');
  end if;
  if not exists (select 1 from vault.secrets where name = 'slack_relay_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'slack_relay_secret',
      'Shared by the notifications trigger and /api/slack/relay; read by the site via slack_relay_secret()');
  end if;
end;
$$;

-- 2. The site reads the secret through this, with the service role. Nobody else may call it.
create or replace function public.slack_relay_secret()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'slack_relay_secret';
$$;
revoke all on function public.slack_relay_secret() from public, anon, authenticated;
grant execute on function public.slack_relay_secret() to service_role;

-- 3. One channel post per deal event: the rep and their admin each get a notification for the
--    same event, and the first one through claims the post. Service role only.
create table if not exists public.slack_channel_posts (
  key text primary key check (char_length(key) <= 120),
  created_at timestamptz not null default now()
);
alter table public.slack_channel_posts enable row level security;
revoke all on public.slack_channel_posts from anon, authenticated;
grant all on public.slack_channel_posts to service_role;

-- 4. Each new notification goes to the site by id (the site reads the row itself). A failure
--    never blocks the notification: the bell still has it.
create or replace function public.notifications_to_slack()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  begin
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'slack_relay_url'$q$ into v_url;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'slack_relay_secret'$q$ into v_secret;
  exception when others then
    v_url := null;
  end;
  if v_url is null or v_secret is null then
    return new;
  end if;
  begin
    execute 'select net.http_post(url := $1, headers := $2, body := $3)'
      using v_url,
            jsonb_build_object('Content-Type', 'application/json', 'x-slack-relay-secret', v_secret),
            jsonb_build_object('id', new.id);
  exception when others then
    null;
  end;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notifications_to_slack() from public, anon, authenticated;

drop trigger if exists notifications_to_slack on public.notifications;
create trigger notifications_to_slack
  after insert on public.notifications
  for each row execute function public.notifications_to_slack();

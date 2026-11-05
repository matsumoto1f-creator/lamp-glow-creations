-- Lamp's team chat is Discord, not Slack (Asad, 2026-11-05; setup in docs/discord.md). This
-- replaces 20261105150000_slack_relay.sql's names with neutral ones and adds the Discord link:
--   profiles.discord_id         set by /api/discord/link when a staff member finishes /lamp link
--   team_relay_url / _secret    the Vault entries (renamed from slack_relay_*; same secret value)
--   team_relay_secret()         the site reads the secret through this (service role only)
--   team_channel_posts          one #deals post per event (renamed from slack_channel_posts)
--   notifications_to_team       the trigger that hands each notification to /api/team/relay
-- Safe to run more than once. Needs pg_net (enabled 2026-11-05).

alter table public.profiles add column if not exists discord_id text;
alter table public.profiles drop constraint if exists profiles_discord_id_ok;
alter table public.profiles add constraint profiles_discord_id_ok
  check (discord_id is null or discord_id ~ '^[0-9]{17,20}$');
create unique index if not exists profiles_discord_id_key on public.profiles (discord_id)
  where discord_id is not null;

-- Vault: rename the Slack entries (keeping the secret's value), or make them on a fresh database.
do $$
declare
  v_id uuid;
  v_val text;
begin
  select id into v_id from vault.secrets where name = 'slack_relay_url';
  if v_id is not null then
    perform vault.update_secret(v_id, 'https://getlamp.app/api/team/relay', 'team_relay_url',
      'Where the database hands notifications to the team chat (the site route)');
  elsif not exists (select 1 from vault.secrets where name = 'team_relay_url') then
    perform vault.create_secret('https://getlamp.app/api/team/relay', 'team_relay_url',
      'Where the database hands notifications to the team chat (the site route)');
  end if;

  select id, decrypted_secret into v_id, v_val from vault.decrypted_secrets
   where name = 'slack_relay_secret';
  if v_id is not null then
    perform vault.update_secret(v_id, v_val, 'team_relay_secret',
      'Shared by the notifications trigger and /api/team/relay; read by the site via team_relay_secret()');
  elsif not exists (select 1 from vault.secrets where name = 'team_relay_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'team_relay_secret',
      'Shared by the notifications trigger and /api/team/relay; read by the site via team_relay_secret()');
  end if;
end;
$$;

drop function if exists public.slack_relay_secret();
create or replace function public.team_relay_secret()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'team_relay_secret';
$$;
revoke all on function public.team_relay_secret() from public, anon, authenticated;
grant execute on function public.team_relay_secret() to service_role;

do $$
begin
  if to_regclass('public.slack_channel_posts') is not null
     and to_regclass('public.team_channel_posts') is null then
    alter table public.slack_channel_posts rename to team_channel_posts;
  end if;
end;
$$;
create table if not exists public.team_channel_posts (
  key text primary key check (char_length(key) <= 120),
  created_at timestamptz not null default now()
);
alter table public.team_channel_posts enable row level security;
revoke all on public.team_channel_posts from anon, authenticated;
grant all on public.team_channel_posts to service_role;

drop trigger if exists notifications_to_slack on public.notifications;
drop function if exists public.notifications_to_slack();

create or replace function public.notifications_to_team()
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
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'team_relay_url'$q$ into v_url;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'team_relay_secret'$q$ into v_secret;
  exception when others then
    v_url := null;
  end;
  if v_url is null or v_secret is null then
    return new;
  end if;
  begin
    execute 'select net.http_post(url := $1, headers := $2, body := $3)'
      using v_url,
            jsonb_build_object('Content-Type', 'application/json', 'x-team-relay-secret', v_secret),
            jsonb_build_object('id', new.id);
  exception when others then
    null;
  end;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notifications_to_team() from public, anon, authenticated;

drop trigger if exists notifications_to_team on public.notifications;
create trigger notifications_to_team
  after insert on public.notifications
  for each row execute function public.notifications_to_team();

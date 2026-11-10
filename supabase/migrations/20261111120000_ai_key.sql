-- Lamp's Anthropic key, set by an admin from Staff > AI activity.
--
-- Until now the key could only be put in the server's secrets (ANTHROPIC_API_KEY in Lovable), which
-- needs the Lovable workspace. This lets an admin paste it on the AI activity page instead. The key
-- is kept in the database's Vault (encrypted at rest), the same place the chat nudge keeps its
-- secret. Nobody reads it back: the page only learns whether a key is saved, who saved it and
-- when. Only Lamp's server (service_role) can call these functions; the site's own route checks
-- the caller is an admin first (src/lib/ai-key.server.ts). A key in the server's secrets still
-- wins over a saved one.
--
-- Safe to run more than once. Changes no existing table, policy or data.

/** The saved key, for Lamp's server only. Null when none is saved (or there is no Vault). */
create or replace function public.ai_key()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'anthropic_api_key';
  return k;
exception when others then
  return null;
end;
$$;
revoke all on function public.ai_key() from public, anon, authenticated;
grant execute on function public.ai_key() to service_role;

/** Whether a key is saved, who saved it and when. Never the key. */
create or replace function public.ai_key_info()
returns table (is_set boolean, saved_by text, saved_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select true, s.description, s.updated_at
    from vault.secrets s
    where s.name = 'anthropic_api_key';
  if not found then
    return query select false, null::text, null::timestamptz;
  end if;
exception when others then
  return query select false, null::text, null::timestamptz;
end;
$$;
revoke all on function public.ai_key_info() from public, anon, authenticated;
grant execute on function public.ai_key_info() to service_role;

/** Saves the key, replacing any saved one. _by is the admin's name, kept beside it. */
create or replace function public.ai_key_set(_key text, _by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
begin
  if _key is null or char_length(trim(_key)) < 20 or char_length(_key) > 400 then
    raise exception 'That does not look like a key.' using errcode = '22023';
  end if;
  select id into existing from vault.secrets where name = 'anthropic_api_key';
  if existing is null then
    perform vault.create_secret(trim(_key), 'anthropic_api_key', left(coalesce(_by, ''), 120));
  else
    perform vault.update_secret(existing, trim(_key), 'anthropic_api_key', left(coalesce(_by, ''), 120));
  end if;
end;
$$;
revoke all on function public.ai_key_set(text, text) from public, anon, authenticated;
grant execute on function public.ai_key_set(text, text) to service_role;

/** Removes the saved key. Claude then stops, unless the server's secrets hold a key. */
create or replace function public.ai_key_clear()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault.secrets where name = 'anthropic_api_key';
end;
$$;
revoke all on function public.ai_key_clear() from public, anon, authenticated;
grant execute on function public.ai_key_clear() to service_role;

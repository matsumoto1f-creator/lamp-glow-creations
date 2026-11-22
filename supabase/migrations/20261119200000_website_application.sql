-- The website's own full application (Asad, 2026-11-19, the funnel map he signed off): getlamp.app's
-- "Check my options" now leads into the full application on getlamp.app/application, with no rep.
-- submit_link_application gets one more case: no token and no rep (_rep_slug '' or null) is the
-- website. The file lands unassigned, its utm says source website_application (the file's
-- "Came in" line says it came from the website), and the website as a whole takes at most 30 an
-- hour. A personal link and a rep's public link work exactly as before.
--
-- Only this function changes (the same body as 20261027120000_application_links.sql, plus the
-- website case). Run once in the SQL editor; running it again is safe.

-- the website's hourly cap below reads this
create index if not exists applications_website_link_idx
  on public.applications (created_at)
  where invite_id is null and utm ->> 'source' = 'website_application';

create or replace function public.submit_link_application(
  _token_hash text,
  _rep_slug text,
  _details jsonb,
  _signed_name text,
  _signature_image text,
  _signed_name_2 text,
  _signature_image_2 text,
  _consent_text text,
  _consent_version text,
  _signer_agent text,
  _signer_ip text,
  _claim_email text,
  _claim_token_hash text
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  inv public.application_invites;
  rep text;
  rep_name text;
  app_id uuid;
  owner0 jsonb := coalesce(_details -> 'owners' -> 0, '{}'::jsonb);
  biz jsonb := coalesce(_details -> 'business', '{}'::jsonb);
  recent int;
  amt numeric;
  ip_key text;
  s_at timestamptz;
  s_ip text;
  website boolean := false;
begin
  if _claim_token_hash is null or _claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request: claim token' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(_details) <> 'object'
     or jsonb_typeof(_details -> 'owners') <> 'array'
     or jsonb_array_length(_details -> 'owners') not between 1 and 2
     or jsonb_typeof(coalesce(_details -> 'balances', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(_details -> 'business', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(_details -> 'request', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(_details -> 'real_estate', '{}'::jsonb)) <> 'object' then
    raise exception 'bad_request: application shape' using errcode = 'invalid_parameter_value';
  end if;
  if length(trim(coalesce(_signed_name, ''))) < 3 or _signature_image is null then
    raise exception 'bad_request: signature' using errcode = 'invalid_parameter_value';
  end if;

  -- the same network can't sign more than a handful of applications an hour; the lock makes
  -- parallel requests from one network take turns, so each one counts the rows before it
  if _signer_ip is not null then
    ip_key := public._ip_key(left(_signer_ip, 64));
    perform pg_advisory_xact_lock(hashtext('link_ip:' || ip_key));
    select count(*) into recent from public.application_details
    where signed_via = 'link' and signed_at > now() - interval '1 hour'
      and public._ip_key(signer_ip) = ip_key;
    if recent >= 6 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
  end if;

  if _token_hash is not null then
    select * into inv from public.application_invites where token_hash = _token_hash for update;
    if not found then
      raise exception 'link_not_found' using errcode = 'P0001';
    end if;
    if inv.submitted_at is not null then
      raise exception 'already_signed' using errcode = 'P0001';
    end if;
    if inv.cancelled_at is not null then
      raise exception 'link_cancelled' using errcode = 'P0001';
    end if;
    if inv.expires_at < now() then
      raise exception 'link_expired' using errcode = 'P0001';
    end if;
    rep := inv.rep_slug;
  elsif coalesce(trim(_rep_slug), '') = '' then
    -- the website's own application (getlamp.app/application): no rep, the file lands unassigned.
    -- At most 30 an hour across the whole website, so a flood can't bury the board.
    website := true;
    rep := null;
    perform pg_advisory_xact_lock(hashtext('link_rep:website'));
    select count(*) into recent from public.applications
    where rep_slug is null and invite_id is null and utm ->> 'source' = 'website_application'
      and created_at > now() - interval '1 hour';
    if recent >= 30 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
  else
    select slug into rep from public.reps where slug = lower(trim(coalesce(_rep_slug, ''))) and active;
    if rep is null then
      raise exception 'unknown_rep' using errcode = 'P0001';
    end if;
    -- a rep's public link takes at most 20 applications an hour, however many networks they
    -- come from, so a flood can't bury the rep's board or use up the mailbox that tells them
    perform pg_advisory_xact_lock(hashtext('link_rep:' || rep));
    select count(*) into recent from public.applications
    where source_rep_slug = rep and invite_id is null and utm ->> 'source' = 'application_link'
      and created_at > now() - interval '1 hour';
    if recent >= 20 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
  end if;
  if rep is not null then
    select name into rep_name from public.reps where slug = rep;
  end if;

  -- the amount is typed freely on the form ("0", "75.000,00"); a value the column can't hold
  -- is left empty for the rep to confirm rather than failing a signed application
  begin
    amt := round(public._num(_details -> 'request' ->> 'amount'), 2);
    if amt <= 0 or amt >= 1e12 then
      amt := null;
    end if;
  exception when others then
    amt := null;
  end;

  insert into public.applications (
    user_id, rep_slug, source_rep_slug, assigned_at, answers, utm, first_name, business_name, phone,
    email, amount_requested, phone_consent_at, phone_consent_text, claim_email, claim_token_hash,
    invite_id
  ) values (
    null, rep, rep, case when rep is null then null else now() end, '{}'::jsonb,
    case when website then jsonb_build_object('source', 'website_application')
      else jsonb_build_object('ref', rep, 'source', 'application_link') end
      || case when inv.id is not null then jsonb_build_object('invite', inv.id) else '{}'::jsonb end,
    nullif(trim(coalesce(owner0 ->> 'first', '')), ''),
    nullif(trim(coalesce(biz ->> 'legal_name', '')), ''),
    nullif(trim(coalesce(owner0 ->> 'mobile', biz ->> 'phone', '')), ''),
    lower(nullif(trim(coalesce(_claim_email, '')), '')),
    amt,
    case when coalesce(owner0 ->> 'mobile', '') <> '' then now() end,
    case when coalesce(owner0 ->> 'mobile', '') <> ''
      then 'Signed application, ' || coalesce(_consent_version, '') || ': contact consent clause' end,
    lower(nullif(trim(coalesce(_claim_email, '')), '')),
    _claim_token_hash,
    inv.id
  )
  returning id into app_id;

  perform set_config('lamp.link_signing', 'on', true);
  insert into public.application_details (
    application_id, user_id, business, owners, balances, request, real_estate,
    signed_name, signature_image, signed_name_2, signature_image_2,
    consent_text, consent_version, signer_agent, signer_ip
  ) values (
    app_id, null,
    coalesce(_details -> 'business', '{}'::jsonb),
    _details -> 'owners',
    coalesce(_details -> 'balances', '[]'::jsonb),
    coalesce(_details -> 'request', '{}'::jsonb),
    coalesce(_details -> 'real_estate', '{}'::jsonb),
    _signed_name, _signature_image, _signed_name_2, _signature_image_2,
    _consent_text, _consent_version, left(_signer_agent, 300), left(_signer_ip, 64)
  )
  -- what the guard stamped, for the signature record on the signed PDF
  returning signed_at, signer_ip into s_at, s_ip;
  perform set_config('lamp.link_signing', 'off', true);

  insert into public.events (application_id, kind, body, payload)
  values (
    app_id, 'system',
    case when inv.id is not null
      then 'Submitted from the application link ' || coalesce(rep_name, rep) || ' sent'
        || coalesce(' to ' || inv.email, '')
      when website then 'Submitted from the website''s application (getlamp.app)'
      else 'Submitted from ' || coalesce(rep_name, rep) || '''s public application link' end,
    jsonb_build_object('invite_id', inv.id, 'ip', _signer_ip, 'agent', left(_signer_agent, 300))
  );

  if inv.id is not null then
    update public.application_invites
       set submitted_at = now(), application_id = app_id,
           started_at = coalesce(started_at, now()), opened_at = coalesce(opened_at, now())
     where id = inv.id;
    if inv.engine_lead_id is not null then
      update public.engine_leads
         set status = 'submitted', worked_at = now()
       where id = inv.engine_lead_id
         and status in ('new', 'called', 'no_answer', 'callback', 'qualified');
    end if;
  end if;

  return jsonb_build_object('application_id', app_id, 'rep_slug', rep, 'rep_name', rep_name,
                            'invite_id', inv.id, 'signed_at', s_at, 'signer_ip', s_ip);
end;
$$;
revoke all on function public.submit_link_application(text, text, jsonb, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_link_application(text, text, jsonb, text, text, text, text, text, text, text, text, text, text)
  to service_role;

-- read-only check for the person running this: expect website_case true
select position('website_application' in pg_get_functiondef(
  'public.submit_link_application(text, text, jsonb, text, text, text, text, text, text, text, text, text, text)'::regprocedure)) > 0
  as website_case;

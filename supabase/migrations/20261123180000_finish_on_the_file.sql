-- "Email them to finish it" on a file sends the merchant their application with what the file
-- already knows filled in (Asad, 2026-11-23: "make the finish email on a file send the prefilled
-- application"; "any account that has a file always receives their prefilled"). Until now that
-- email sent them to sign in to their account, and any link they signed made a SECOND file.
--
-- 1. application_invites.file_id: the file a link was made from. Null for every other link.
-- 2. submit_link_application: a link with a file_id signs onto that file. The file keeps its
--    account, rep, stage and timeline; it gains the full application, the invite, and a claim
--    token so the page can add statements and the signed copy right after signing. An unsigned
--    draft the merchant started on their account is replaced by what they signed; a file that is
--    already signed refuses. The rep is told, since no new file announces itself.
--    Everything else in the function is unchanged from 20261119200000_website_application.sql.
-- Run once in the SQL editor, BEFORE publishing the code that uses it; running it again is safe.
-- Before it is run the site keeps sending the old "finish on your account" email.

alter table public.application_invites
  add column if not exists file_id uuid references public.applications (id) on delete set null;
create index if not exists application_invites_file_id_idx
  on public.application_invites (file_id) where file_id is not null;

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
  target public.applications;
  onto_file boolean := false;
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
    -- (a link made from a file keeps that file's own rep; see below)
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

  -- A link made from a file (application_invites.file_id): the signed application goes onto that
  -- file. No second file is made, and the file keeps its account, rep, stage and timeline.
  if inv.file_id is not null then
    select * into target from public.applications where id = inv.file_id for update;
    if not found then
      raise exception 'link_not_found' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.application_details
               where application_id = target.id and signed_at is not null) then
      raise exception 'already_signed' using errcode = 'P0001';
    end if;
    -- a draft the merchant started on their account gives way to what they just signed
    delete from public.application_details where application_id = target.id and signed_at is null;
    onto_file := true;
    app_id := target.id;
    update public.applications
       set first_name = coalesce(nullif(trim(coalesce(owner0 ->> 'first', '')), ''), first_name),
           business_name = coalesce(nullif(trim(coalesce(biz ->> 'legal_name', '')), ''), business_name),
           phone = coalesce(nullif(trim(coalesce(owner0 ->> 'mobile', biz ->> 'phone', '')), ''), phone),
           email = coalesce(email, lower(nullif(trim(coalesce(_claim_email, '')), ''))),
           amount_requested = coalesce(amt, amount_requested),
           phone_consent_at = coalesce(phone_consent_at,
             case when coalesce(owner0 ->> 'mobile', '') <> '' then now() end),
           phone_consent_text = coalesce(phone_consent_text,
             case when coalesce(owner0 ->> 'mobile', '') <> ''
               then 'Signed application, ' || coalesce(_consent_version, '') || ': contact consent clause' end),
           utm = coalesce(utm, '{}'::jsonb) || jsonb_build_object('invite', inv.id),
           invite_id = inv.id,
           -- for the statements and the signed copy the page uploads right after signing
           claim_token_hash = _claim_token_hash,
           claim_email = case when user_id is null
             then lower(nullif(trim(coalesce(_claim_email, '')), '')) else claim_email end
     where id = target.id;
  else
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
  end if;

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

  if onto_file then
    -- the file's own account sees its signed application, the way a claim hands one over
    if target.user_id is not null then
      perform set_config('lamp.claiming', 'on', true);
      update public.application_details set user_id = target.user_id where application_id = app_id;
      perform set_config('lamp.claiming', 'off', true);
    end if;
    -- a new file tells its rep by itself (notifications_on_application); this one already existed
    perform public.notify_rep_and_lead(
      target.rep_slug, 'file',
      'Signed: ' || coalesce(nullif(target.business_name, ''), nullif(target.first_name, ''), 'a merchant'),
      'The full application was signed from the link you sent.',
      '/staff?file=' || app_id, app_id);
  end if;

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


-- read-only summary for the person running this: expect column_present true, function_knows_files true
select
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'application_invites' and column_name = 'file_id') as column_present,
  (select position('inv.file_id' in pg_get_functiondef(p.oid)) > 0 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_link_application') as function_knows_files;

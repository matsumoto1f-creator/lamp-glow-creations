-- Rep agreements signed at first sign-in (Stevie, 2026-11-19 sales training: "terms and conditions
-- ... when they first sign in ... to protect us", and later onboarding documents).
--
-- An admin writes a document on Staff > Team (a rep agreement, a confidentiality agreement, ...),
-- saves it as a draft and publishes it. From then on every staff member who is not an admin sees
-- it before anything else on the staff page and signs it: a box to tick and their typed full name.
-- Publishing a new version of the same document asks everyone again.
--   * rep_documents: one row per version. A draft can be edited or thrown away; once published,
--     its title, text and version never change and it is never deleted (only "stop asking",
--     retired_at, can be set or cleared), so what a rep signed is always the text they saw;
--   * rep_document_signatures: one row per person per version: the typed name, when, the
--     address and browser it came from, and a SHA-256 of the exact text. Never changed, never
--     deleted, and no link to auth.users, so removing a login does not remove the record;
--   * reading: staff read published documents; each person reads their own signatures; admins
--     read everything. Writing goes only through /api/rep-documents (the service key), which
--     checks who is asking. No table here takes a write from the browser.
--
-- Nothing existing is changed. Run once in the SQL editor; running it again is safe.

-- ---------- documents: one row per version ----------
create table if not exists public.rep_documents (
  id uuid primary key default gen_random_uuid(),
  doc_key text not null check (doc_key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  version int not null check (version >= 1),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 100000),
  body_sha256 text check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid,
  retired_at timestamptz,
  unique (doc_key, version),
  check (published_at is null or body_sha256 is not null)
);
-- at most one draft per document
create unique index if not exists rep_documents_one_draft_idx
  on public.rep_documents (doc_key) where published_at is null;

-- ---------- signatures: one row per person per version ----------
create table if not exists public.rep_document_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.rep_documents (id) on delete restrict,
  user_id uuid not null,
  signer_email text check (signer_email is null or char_length(signer_email) <= 320),
  typed_name text not null check (char_length(btrim(typed_name)) between 3 and 120),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null default now(),
  ip text check (ip is null or char_length(ip) <= 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  unique (document_id, user_id)
);
create index if not exists rep_document_signatures_user_idx
  on public.rep_document_signatures (user_id);

-- ---------- a published version is fixed; a signature is permanent ----------
create or replace function public.rep_documents_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'A published document is kept for the record and cannot be deleted.';
    end if;
    return old;
  end if;
  if old.published_at is not null then
    if new.doc_key is distinct from old.doc_key
      or new.version is distinct from old.version
      or new.title is distinct from old.title
      or new.body is distinct from old.body
      or new.body_sha256 is distinct from old.body_sha256
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by then
      raise exception 'A published document cannot be changed. Save a new version instead.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rep_documents_guard on public.rep_documents;
create trigger rep_documents_guard
  before update or delete on public.rep_documents
  for each row execute function public.rep_documents_guard();

create or replace function public.rep_document_signatures_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'A signature is kept for the record and cannot be changed or deleted.';
end;
$$;

drop trigger if exists rep_document_signatures_guard on public.rep_document_signatures;
create trigger rep_document_signatures_guard
  before update or delete on public.rep_document_signatures
  for each row execute function public.rep_document_signatures_guard();

-- a signature only for a published, current version
create or replace function public.rep_document_signatures_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  d public.rep_documents;
begin
  select * into d from public.rep_documents where id = new.document_id;
  if d.published_at is null then
    raise exception 'That document is a draft and cannot be signed.';
  end if;
  if new.body_sha256 is distinct from d.body_sha256 then
    raise exception 'The signed text does not match the document.';
  end if;
  return new;
end;
$$;

drop trigger if exists rep_document_signatures_check on public.rep_document_signatures;
create trigger rep_document_signatures_check
  before insert on public.rep_document_signatures
  for each row execute function public.rep_document_signatures_check();

-- ---------- who reads what ----------
alter table public.rep_documents enable row level security;
alter table public.rep_document_signatures enable row level security;

revoke insert, update, delete, truncate on public.rep_documents from anon, authenticated;
revoke insert, update, delete, truncate on public.rep_document_signatures from anon, authenticated;
revoke all on public.rep_documents from anon;
revoke all on public.rep_document_signatures from anon;
grant select on public.rep_documents to authenticated;
grant select on public.rep_document_signatures to authenticated;

drop policy if exists "Staff read published rep documents" on public.rep_documents;
create policy "Staff read published rep documents"
  on public.rep_documents for select to authenticated
  using (
    (published_at is not null and (select public.is_staff()))
    or (select public.has_role('admin'))
  );

drop policy if exists "Own signatures, admins all" on public.rep_document_signatures;
create policy "Own signatures, admins all"
  on public.rep_document_signatures for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));

-- read-only summary for the person running this: both tables (2) and the three triggers (3)
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('rep_documents', 'rep_document_signatures')) as tables_present,
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
     'rep_documents_guard', 'rep_document_signatures_guard', 'rep_document_signatures_check'))
    as triggers_present;

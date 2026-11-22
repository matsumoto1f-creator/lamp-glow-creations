-- A copy of every file's documents in the company Google Drive (Asad, 2026-11-19: "we have a
-- company google drive that i want to link this to to organize the files").
--
-- The server signs in to Google as partners@getlamp.app (the same connection that sends funder
-- emails, now also asking for Drive's "files this app creates" permission). It makes a "Lamp files"
-- folder, one folder per file inside it, and copies each document there. Two small tables remember
-- what is already copied, so nothing is copied twice:
--   * drive_folders: 'root' and one row per application -> its Drive folder id;
--   * drive_copies: one row per document -> its Drive file id.
-- Only the server's key reads or writes them: the browser gets nothing (no policies, no grants).
-- The copies are extra: the documents themselves stay where they are, and deleting a copy in Drive
-- changes nothing in Lamp. Nothing existing is changed. Run once; running it again is safe.

create table if not exists public.drive_folders (
  key text primary key check (key = 'root' or key ~ '^app:[0-9a-f-]{36}$'),
  folder_id text not null check (folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.drive_copies (
  document_id uuid primary key references public.documents (id) on delete cascade,
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  copied_at timestamptz not null default now()
);

alter table public.drive_folders enable row level security;
alter table public.drive_copies enable row level security;
revoke all on public.drive_folders from anon, authenticated;
revoke all on public.drive_copies from anon, authenticated;
grant all on public.drive_folders to service_role;
grant all on public.drive_copies to service_role;

-- read-only summary for the person running this: expect tables_present 2
select count(*) as tables_present from pg_tables
where schemaname = 'public' and tablename in ('drive_folders', 'drive_copies');

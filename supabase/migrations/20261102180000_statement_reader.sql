-- The statement reader, phase 1 (Asad, 2026-11-02; scope claude.ai/artifact/9LmyqMvwAJPD4HgAon7n96).
--
-- Staff press Read statements on a file. Lamp's server sends each bank statement on the file to
-- Claude, which reads it into figures (balances, deposits, NSF fees, daily balances, funder
-- debits); the server's own code then works out the file's numbers (src/lib/statement-read.ts)
-- and checks every statement adds up. The rep or an admin confirms the report, editing any number
-- they know better. Phase 2 feeds confirmed numbers to the funder matcher; nothing here changes
-- who a file goes to yet.
--   * statement_reads keeps one read per document: what the model read, what it cost, any error;
--   * statement_reports keeps one report per file: the computed figures, and the confirmed ones
--     with who confirmed them and which numbers they changed;
--   * only Lamp's server writes either (service role); staff read them on files they can see
--     (admins all). Merchants read nothing here.
-- The reader runs only when ANTHROPIC_API_KEY is set in the server's secrets, and stops for the
-- month at STATEMENT_MONTHLY_CAP_USD (50 by default).
-- Run once in the SQL editor. Running it again is safe.

create table if not exists public.statement_reads (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  state text not null default 'read' check (state in ('read', 'failed')),
  -- the StatementRead the model returned (statement-read.ts), or null when it failed
  read jsonb,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  error text check (error is null or char_length(error) <= 300),
  read_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_id)
);
create index if not exists statement_reads_file_idx on public.statement_reads (application_id);
create index if not exists statement_reads_month_idx on public.statement_reads (created_at);

create table if not exists public.statement_reports (
  application_id uuid primary key references public.applications (id) on delete cascade,
  -- Figures (statement-read.ts) worked out from every read on the file
  figures jsonb not null,
  -- the same shape once a person confirmed it, with their edits applied
  confirmed jsonb,
  -- { field: [computed, confirmed] } for each number the person changed
  edits jsonb not null default '{}'::jsonb,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_by_name text,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.statement_reads enable row level security;
alter table public.statement_reports enable row level security;
revoke all on public.statement_reads from anon, authenticated;
revoke all on public.statement_reports from anon, authenticated;
grant select on public.statement_reads to authenticated;
grant select on public.statement_reports to authenticated;
grant all on public.statement_reads to service_role;
grant all on public.statement_reports to service_role;

drop policy if exists "Staff read statement reads" on public.statement_reads;
create policy "Staff read statement reads" on public.statement_reads
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );

drop policy if exists "Staff read statement reports" on public.statement_reports;
create policy "Staff read statement reports" on public.statement_reports
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );

-- No What's new yet: announce it once ANTHROPIC_API_KEY is set and the reader is on.

notify pgrst, 'reload schema';

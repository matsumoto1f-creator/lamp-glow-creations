-- Staff > Email engine (Asad, 2026-11-12: "i want to see the system schedule ... and also reflecting
-- in the portal for the admins so we can see everything running").
--
-- The War Room email autopilot posts a snapshot of itself after every scheduled run to
-- /api/engine/status with the engine's shared secret: its three jobs (schedule, last run, what it
-- did), each Lamp mailbox against its daily cap, today's numbers, the sending queue and whatever is
-- holding it back. Counts, job names and summaries only: no email text, no business addresses.
--   * engine_status keeps the latest snapshot, one row per engine (today only "lamp-email");
--   * only Lamp's server reads or writes it (service role), and it shows it to admins only.
-- Run once in the SQL editor. Running it again is safe and changes nothing (the What's new goes out once).

create table if not exists public.engine_status (
  key text primary key check (key ~ '^[a-z0-9-]{1,40}$'),
  snapshot jsonb not null check (pg_column_size(snapshot) <= 200000),
  received_at timestamptz not null default now()
);

alter table public.engine_status enable row level security;
revoke all on public.engine_status from anon, authenticated;
grant all on public.engine_status to service_role;

-- ---------- What's new (admins) ----------
select public.announce(
  'Admins: the email engine, live',
  'Staff > Email engine shows the email autopilot as it runs: when each job runs next, what its last run did, each Lamp mailbox against its daily cap, today''s drafts and replies, the sending queue, and anything holding it back.',
  '/staff?view=autopilot',
  'admin'
)
where not exists (
  select 1 from public.notifications
  where kind = 'announcement' and title = 'Admins: the email engine, live'
);

notify pgrst, 'reload schema';

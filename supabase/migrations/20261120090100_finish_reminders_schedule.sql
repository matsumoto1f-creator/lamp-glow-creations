-- The on switch for "finish your application" reminders: every 10 minutes the database asks the
-- site (POST /api/application/remind, through finish_remind_tick()) to send whatever is due.
-- Runs after 20261120090000_finish_reminders.sql. Needs pg_cron and pg_net; without pg_cron it
-- says so and does nothing, and another scheduler can POST to /api/application/remind with the
-- x-finish-remind-secret header instead.
-- Turn it off: select cron.unschedule('lamp-finish-reminders');
-- Safe to run more than once (cron.schedule with the same name replaces the job).

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron is not available here; schedule POST /api/application/remind elsewhere.';
      return;
    end;
  end if;
  execute $q$select cron.schedule('lamp-finish-reminders', '*/10 * * * *', 'select public.finish_remind_tick()')$q$;
end;
$$;

-- read-only check: expect one row, active true
select jobname, schedule, active from cron.job where jobname = 'lamp-finish-reminders';

-- The merchant email nudge, every 5 minutes (phase 2 of the in-app chat).
--
-- Schedules chat_nudge_tick() with pg_cron: it posts to /api/chat/nudge with the relay secret from
-- the Vault, and the site emails each merchant whose staff reply has waited 15 minutes unread (at
-- most once every 4 hours per conversation): a link to their account, never the message.
-- Needs pg_cron and pg_net. If this database has no pg_cron, it says so and does nothing; the War
-- Room's scheduler can POST to /api/chat/nudge with the same secret header instead.
-- Stop it: select cron.unschedule('lamp-chat-nudge');
-- Safe to run more than once.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron is not available here; schedule POST /api/chat/nudge elsewhere.';
      return;
    end;
  end if;
  execute $q$select cron.schedule('lamp-chat-nudge', '*/5 * * * *', 'select public.chat_nudge_tick()')$q$;
end;
$$;

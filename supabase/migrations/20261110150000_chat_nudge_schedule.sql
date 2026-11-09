-- The merchant email nudge, every 5 minutes (in-app chat; runs after 20261110140000_chat_merchant.sql).
--
-- Schedules chat_nudge_tick() with pg_cron: it posts to the chat_nudge_url Vault entry
-- (https://getlamp.app/api/chat/nudge) with the chat_nudge_secret header, and the site emails each
-- merchant whose Lamp reply has waited 15 minutes unread (at most once every 4 hours per
-- conversation): a link to their account, never the message.
-- Needs pg_cron and pg_net. If this database has no pg_cron, it says so and does nothing; another
-- scheduler can POST to /api/chat/nudge with the same header instead.
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

-- Live updates for conversations and Notes & calls (phase 2 of the in-app chat).
--
-- Adds chat_messages and file_notes to Supabase Realtime's publication. Each listener only gets
-- rows its own select rule lets it read (Postgres Changes checks the rule per listener), so a rep
-- never receives another rep's merchant or an admins-only note. Without this file the pages poll
-- every 15 seconds instead; with it they update at once and poll every minute as a backstop.
-- Turn it off: alter publication supabase_realtime drop table public.chat_messages, public.file_notes;
-- Safe to run more than once.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here; nothing to do.';
    return;
  end if;
  foreach t in array array['chat_messages', 'file_notes'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Team leads: a rep with a team sees the team's files, and changes nothing on them.
--
-- A rep already reports to someone (reps.admin_slug, set by an admin on Staff > Team), and
-- that person already shares the team's chat room, the merchant conversation and the reply
-- notifications. Until now they also had to be an admin to see the team's files, which gave
-- them the whole company. After this file a team lead who is NOT an admin:
--
--   reads   their own files and the unassigned pool, as every rep does, plus every file whose
--           rep reports to them, and on those files what the rep reads: events, documents and
--           the stored files, document requests, submissions, offers and their notes, the
--           staff notes, the team notes, the statement report, the owner's profile and
--           businesses.
--   writes  a team note on a team file (file_notes, visibility 'team'), and the conversation
--           with the merchant (already theirs, chat_can_use_file). Nothing else: stage, staff
--           notes, document review, submissions, offers and offer notes stay with the rep
--           whose file it is, and with admins.
--   never   the full application (SSN, date of birth, bank details): can_see_application_details()
--           is untouched, so it stays with the file's own rep and admins. Nor the team's leads,
--           engine leads and sent application links (those lists stay each rep's own), other
--           teams' files, anyone else's deals and commission ledger, reps and roles, funders'
--           edits, admins-only notes, calls, or anything on the admin tabs.
--
-- How: "may read" and "may work" used to be one test (the file is mine or unassigned). They
-- are now two. rep_can_see_application(), rep_can_see_user() and rep_can_read_file() add the
-- team; the new rep_can_work_application() keeps the old test, and every policy that WRITES
-- through the old one moves to it. "Staff read pipeline" on applications named the rep inline
-- and gets the team too; its update policy is untouched. file_notes keeps
-- rep_can_see_application() for its insert, which is what lets a lead leave a team note.
--
-- A lead is whoever an active rep's admin_slug points at; there is no new role. The lead's own
-- seat must be active and they must still hold the rep (or admin) role. A rep who has left
-- (inactive) keeps reporting to their lead, so their files stay supervised.
--
-- Unchanged: every merchant rule, every admin rule, a rep with no team (my_team_slugs() is
-- empty, so every test reads as before), the service role.
--
-- Run after 20261112150000_private_lists.sql. Safe to run twice. To make someone a team lead
-- with no company access: on Staff > Team, leave their reps reporting to them and untick
-- Admin.

set lock_timeout = '5s';

-- ---------- Helpers ----------
-- The slugs of the reps who report to the signed-in person. Empty for someone with no team, no
-- active seat, or no staff role. Takes no argument on purpose: it answers only for the caller.
create or replace function public.my_team_slugs()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r.slug), '{}'::text[])
  from public.reps me
  join public.reps r on r.admin_slug = me.slug
  where me.user_id = auth.uid()
    and me.active
    and public.is_staff(auth.uid());
$$;
revoke all on function public.my_team_slugs() from public, anon;
grant execute on function public.my_team_slugs() to authenticated, service_role;

-- May the signed-in rep WORK this application (change it, add to it)? The test every staff
-- policy used before team leads: the file is theirs or unassigned.
create or replace function public.rep_can_work_application(_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.applications a
    where a.id = _application_id
      and (a.rep_slug is null or a.rep_slug = public.current_rep_slug(auth.uid()))
  );
$$;
revoke all on function public.rep_can_work_application(uuid) from public, anon;
grant execute on function public.rep_can_work_application(uuid) to authenticated, service_role;

-- The same question for the site's server, admins included: it asks this before it acts on a
-- file with its own key (a document request, a statement read).
create or replace function public.can_work_application(_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin')
    or (public.is_staff() and public.rep_can_work_application(_application_id));
$$;
revoke all on function public.can_work_application(uuid) from public, anon;
grant execute on function public.can_work_application(uuid) to authenticated, service_role;

-- May the signed-in rep SEE this application? Theirs, unassigned, or their team's.
create or replace function public.rep_can_see_application(_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.applications a
    where a.id = _application_id
      and (a.rep_slug is null
           or a.rep_slug = public.current_rep_slug(auth.uid())
           or a.rep_slug = any (public.my_team_slugs()))
  );
$$;
revoke all on function public.rep_can_see_application(uuid) from public, anon;
grant execute on function public.rep_can_see_application(uuid) to authenticated, service_role;

-- Does the signed-in rep have a file of this user's in view? (profiles and businesses)
create or replace function public.rep_can_see_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.applications a
    where a.user_id = _user_id
      and (a.rep_slug is null
           or a.rep_slug = public.current_rep_slug(auth.uid())
           or a.rep_slug = any (public.my_team_slugs()))
  );
$$;
revoke all on function public.rep_can_see_user(uuid) from public, anon;
grant execute on function public.rep_can_see_user(uuid) to authenticated, service_role;

-- A stored file follows its documents row. One with no row yet is readable only when every
-- application of the folder's owner is the rep's, unassigned, or their team's.
create or replace function public.rep_can_read_file(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  slug text := public.current_rep_slug(auth.uid());
  team text[] := public.my_team_slugs();
  app_id uuid;
  owner_id text := split_part(_name, '/', 1);
begin
  select d.application_id into app_id
  from public.documents d
  where d.bucket = 'documents' and d.storage_path = _name;
  if found then
    return public.rep_can_see_application(app_id);
  end if;
  return exists (select 1 from public.applications a where a.user_id::text = owner_id)
     and not exists (
       select 1 from public.applications a
       where a.user_id::text = owner_id
         and a.rep_slug is not null
         and a.rep_slug is distinct from slug
         and not (a.rep_slug = any (team))
     );
end;
$$;
revoke all on function public.rep_can_read_file(text) from public, anon;
grant execute on function public.rep_can_read_file(text) to authenticated, service_role;

-- ---------- The one read that named the rep inline: add the team ----------
drop policy if exists "Staff read pipeline" on public.applications;
create policy "Staff read pipeline" on public.applications
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug())
           or rep_slug is null
           or rep_slug = any ((select public.my_team_slugs())::text[]))
    )
  );

-- ---------- Writes: the file must be the rep's own or unassigned, as before ----------
drop policy if exists "Staff log events" on public.events;
create policy "Staff log events" on public.events
  for insert to authenticated
  with check (
    (select public.is_staff())
    and actor_user_id = (select auth.uid())
    and (
      (select public.has_role('admin'))
      or case
        when application_id is not null then public.rep_can_work_application(application_id)
        else lead_id in (
          select l.id from public.leads l
          where l.rep_slug = (select public.current_rep_slug()) or l.rep_slug is null
        )
      end
    )
  );

drop policy if exists "Staff add internal notes" on public.application_internal_notes;
create policy "Staff add internal notes" on public.application_internal_notes
  for insert to authenticated
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  );
drop policy if exists "Staff change internal notes" on public.application_internal_notes;
create policy "Staff change internal notes" on public.application_internal_notes
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  );
drop policy if exists "Staff clear internal notes" on public.application_internal_notes;
create policy "Staff clear internal notes" on public.application_internal_notes
  for delete to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  );

drop policy if exists "Staff review documents" on public.documents;
create policy "Staff review documents" on public.documents
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  );

drop policy if exists "Staff create submissions" on public.submissions;
create policy "Staff create submissions" on public.submissions
  for insert to authenticated
  with check (
    (select public.is_staff())
    and submitted_by = (select auth.uid())
    and ((select public.has_role('admin')) or public.rep_can_work_application(application_id))
  );
drop policy if exists "Staff update submissions" on public.submissions;
create policy "Staff update submissions" on public.submissions
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  );

drop policy if exists "Staff add offers" on public.offers;
create policy "Staff add offers" on public.offers
  for insert to authenticated
  with check (
    (select public.is_staff())
    and created_by = (select auth.uid())
    and ((select public.has_role('admin')) or public.rep_can_work_application(application_id))
  );
drop policy if exists "Staff update offers" on public.offers;
create policy "Staff update offers" on public.offers
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_work_application(application_id))
  );

drop policy if exists "Staff add offer notes" on public.offer_internal_notes;
create policy "Staff add offer notes" on public.offer_internal_notes
  for insert to authenticated
  with check (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and exists (
        select 1 from public.offers o
        where o.id = offer_internal_notes.offer_id
          and public.rep_can_work_application(o.application_id)
      )
    )
  );
drop policy if exists "Staff change offer notes" on public.offer_internal_notes;
create policy "Staff change offer notes" on public.offer_internal_notes
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and exists (
        select 1 from public.offers o
        where o.id = offer_internal_notes.offer_id
          and public.rep_can_work_application(o.application_id)
      )
    )
  )
  with check (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and exists (
        select 1 from public.offers o
        where o.id = offer_internal_notes.offer_id
          and public.rep_can_work_application(o.application_id)
      )
    )
  );
drop policy if exists "Staff clear offer notes" on public.offer_internal_notes;
create policy "Staff clear offer notes" on public.offer_internal_notes
  for delete to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and exists (
        select 1 from public.offers o
        where o.id = offer_internal_notes.offer_id
          and public.rep_can_work_application(o.application_id)
      )
    )
  );

reset lock_timeout;

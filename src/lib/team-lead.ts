// Team leads: a rep other reps report to (reps.admin_slug). A lead who is not an admin sees the
// team's files and changes nothing on them (see the team_leads migration). The database decides;
// this file only works out what to show, with no browser or database in it so the tests load it.

export type TeamRep = { slug: string; name: string; admin_slug?: string | null };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The slugs that report to `repSlug`, from the reps the page already loaded. */
export const teamOf = (repSlug: string | null, reps: readonly TeamRep[]): string[] =>
  repSlug ? reps.filter((r) => r.admin_slug === repSlug).map((r) => r.slug) : [];

/**
 * The team the database says this person leads, narrowed to slugs the page knows. The database's
 * answer (my_team_slugs) wins; before that SQL runs it is null and nobody is shown as a lead,
 * because the files would not load for them anyway.
 */
export const knownTeam = (fromDb: readonly string[] | null, reps: readonly TeamRep[]): string[] =>
  (fromDb ?? []).filter((s) => SLUG.test(s) && reps.some((r) => r.slug === s));

/** The Files board's rep filter for someone who is not an admin. */
export type LeadFilter = "all" | "mine" | "unassigned" | string;

/**
 * The `or=` filter for the board when the viewer is not an admin: their own files, the unassigned
 * pool and, for a lead, the team's. Policies already limit the rows; naming the reps lets Postgres
 * use the (rep_slug, status, created_at) index. Returns null for "unassigned only".
 */
export function boardFilter(
  repSlug: string | null,
  team: readonly string[],
  pick: LeadFilter,
): { or: string } | { unassigned: true } | { rep: string } {
  const own = repSlug && SLUG.test(repSlug) ? repSlug : null;
  const mates = team.filter((s) => SLUG.test(s));
  if (pick === "unassigned" || (!own && !mates.length)) return { unassigned: true };
  if (pick === "mine" && own) return { rep: own };
  if (pick !== "all" && pick !== "mine" && mates.includes(pick)) return { rep: pick };
  const named = [...(own ? [own] : []), ...mates];
  return {
    or:
      named.length === 1
        ? `rep_slug.eq.${named[0]},rep_slug.is.null`
        : `rep_slug.in.(${named.join(",")}),rep_slug.is.null`,
  };
}

/**
 * Is this viewer only watching the file? True for someone who is not an admin looking at a file
 * that belongs to another rep: the one way that happens is a lead opening a team file. Their own
 * files and unassigned ones are theirs to work.
 */
export const watching = (isAdmin: boolean, repSlug: string | null, fileRep: string | null) =>
  !isAdmin && fileRep !== null && fileRep !== repSlug;

/** "Zeus · Team lead" for the line under the page title. */
export const roleLabel = (isAdmin: boolean, teamSize: number) =>
  isAdmin ? "Admin" : teamSize > 0 ? "Team lead" : "Rep";

/**
 * Reads the answer of can_work_application() for the site's server. "old" means the function
 * isn't in the database yet (the SQL hasn't run): the caller then falls back to the test used
 * before team leads, whether they can see the file. Any other error is a no.
 */
export function workVerdict(r: {
  data: unknown;
  error: { code?: string | null } | null;
}): "yes" | "no" | "old" {
  if (!r.error) return r.data === true ? "yes" : "no";
  return r.error.code === "PGRST202" || r.error.code === "42883" ? "old" : "no";
}

/**
 * Is this row (a sent link, an engine lead) the caller's own to act on? An admin acts on any; a
 * rep only on rows tagged to their own slug. A team lead READS the team's rows, so the server
 * asks this before it acts on one with its own key.
 */
export const ownRow = (isAdmin: boolean, ownSlug: string | null, rowRep: string | null) =>
  isAdmin || (!!ownSlug && rowRep === ownSlug);

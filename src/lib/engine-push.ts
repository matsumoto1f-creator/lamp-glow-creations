// The engine's daily hand-out (2026-11-01): the War Room engine posts each rep's leads for the day
// to /api/engine/push with a shared secret, so they land in Engine leads without anyone pressing
// Upload. This file is the part with no server or database in it, so the tests can load it.
import type { LeadUpload } from "@/lib/engine-leads";

/** One call carries at most this many leads (10 a day for each of a few dozen reps). */
export const MAX_PUSH = 500;

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Checks the posted leads. `reps` are the slugs that may receive leads (active, with a login).
 * A lead that fails is left out and named in `problems`; the rest still go in.
 */
export function parsePush(
  body: unknown,
  reps: string[],
): { leads: LeadUpload[]; problems: string[] } {
  const list = (body as { leads?: unknown } | null)?.leads;
  if (!Array.isArray(list)) return { leads: [], problems: ["Send { leads: [...] }."] };
  if (list.length > MAX_PUSH)
    return { leads: [], problems: [`At most ${MAX_PUSH} leads per call; got ${list.length}.`] };
  const problems: string[] = [];
  const seen = new Set<string>();
  const leads: LeadUpload[] = [];
  list.forEach((raw, i) => {
    const r = (raw ?? {}) as Partial<Record<keyof LeadUpload, unknown>>;
    const at = `Lead ${i + 1}`;
    const source = str(r.source, 60);
    const key = str(r.source_key, 200);
    if (!source || !key) return void problems.push(`${at}: no source or source_key.`);
    if (seen.has(`${source}\u0000${key}`))
      return void problems.push(`${at}: the same lead appears twice.`);
    const slug = (str(r.rep_slug, 40) ?? "").toLowerCase();
    if (!reps.includes(slug))
      return void problems.push(
        `${at}: ${slug ? `"${slug}" is not a rep who can take leads` : "no rep"}.`,
      );
    const tier = (str(r.tier, 1) ?? "").toUpperCase();
    if (tier && !["A", "B", "C", "X"].includes(tier))
      return void problems.push(`${at}: tier "${tier}" should be A, B, C or X.`);
    const need = typeof r.need === "number" && Number.isInteger(r.need) ? r.need : null;
    const found = str(r.first_found, 10);
    seen.add(`${source}\u0000${key}`);
    leads.push({
      source,
      source_key: key,
      name: str(r.name, 200),
      phone: str(r.phone, 40),
      email: str(r.email, 200),
      city: str(r.city, 100),
      state: str(r.state, 2)?.toUpperCase() ?? null,
      industry: str(r.industry, 60),
      tier: tier || null,
      need,
      reason: str(r.reason, 1000),
      signals: Array.isArray(r.signals) ? r.signals.slice(0, 20) : [],
      first_found: found && /^\d{4}-\d{2}-\d{2}$/.test(found) ? found : null,
      rep_slug: slug,
    });
  });
  return { leads, problems };
}

/** How many leads each rep got, for the reply and the notification. */
export function perRep(leads: LeadUpload[]): Record<string, number> {
  return leads.reduce<Record<string, number>>(
    (m, l) => ({ ...m, [l.rep_slug]: (m[l.rep_slug] ?? 0) + 1 }),
    {},
  );
}

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

/** How sure the engine is of a lead's address (engine_leads.email_confidence). */
export const EMAIL_CONFIDENCE = ["confirmed", "verified", "probable"] as const;
export type EmailConfidence = (typeof EMAIL_CONFIDENCE)[number];

/** The engine's address for one lead already in Lamp, and where it came from. */
export type LeadEmail = {
  source: string;
  source_key: string;
  email: string;
  email_confidence: EmailConfidence;
  email_method: string;
};

const ADDRESS = /^[^\s@<>"',;]{1,100}@[^\s@<>"',;]{1,100}\.[^\s@<>"',;.]{2,40}$/;

/**
 * Checks { emails: [...] }: the engine's best address for the owner of leads that are already in
 * Lamp. Each needs the lead (source, source_key), a usable address, how sure the engine is, and one
 * sentence on where it came from. A guess is not one of the three levels, so it cannot come in.
 * One that fails is left out and named in `problems`; the rest still go in.
 */
export function parseEmails(body: unknown): { emails: LeadEmail[]; problems: string[] } {
  const list = (body as { emails?: unknown } | null)?.emails;
  if (!Array.isArray(list)) return { emails: [], problems: ["Send { emails: [...] }."] };
  if (list.length > MAX_PUSH)
    return { emails: [], problems: [`At most ${MAX_PUSH} per call; got ${list.length}.`] };
  const problems: string[] = [];
  const seen = new Set<string>();
  const emails: LeadEmail[] = [];
  list.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const at = `Email ${i + 1}`;
    const source = str(r["source"], 60);
    const key = str(r["source_key"], 200);
    if (!source || !key) return void problems.push(`${at}: no source or source_key.`);
    if (seen.has(`${source}\u0000${key}`))
      return void problems.push(`${at}: the same lead appears twice.`);
    const email = (str(r["email"], 200) ?? "").toLowerCase();
    if (!ADDRESS.test(email)) return void problems.push(`${at}: not a usable address.`);
    const conf = str(r["confidence"], 20) ?? "";
    if (!(EMAIL_CONFIDENCE as readonly string[]).includes(conf))
      return void problems.push(`${at}: confidence should be confirmed, verified or probable.`);
    const method = str(r["method"], 300);
    if (!method) return void problems.push(`${at}: no sentence on where the address came from.`);
    seen.add(`${source}\u0000${key}`);
    emails.push({
      source,
      source_key: key,
      email,
      email_confidence: conf as EmailConfidence,
      email_method: method,
    });
  });
  return { emails, problems };
}

/**
 * What a rep reads under the email box on a lead: where the engine's address came from and what to
 * do with it on the call. Null when the engine has said nothing about the address.
 */
export function emailSourceLine(
  confidence: string | null | undefined,
  method: string | null | undefined,
): { tag: string; text: string } | null {
  const how = (method ?? "").trim().replace(/[.\s]+$/, "");
  if (!how || !(EMAIL_CONFIDENCE as readonly string[]).includes(confidence ?? "")) return null;
  const from = how.charAt(0).toUpperCase() + how.slice(1) + ".";
  if (confidence === "confirmed")
    return { tag: "Owner's address", text: `${from} Still worth confirming on the call.` };
  if (confidence === "verified")
    return {
      tag: "Mailbox checked",
      text: `${from} Confirm on the call that it's theirs.`,
    };
  return { tag: "Likely, not confirmed", text: `${from} Ask on the call for the owner's own.` };
}

/** How many leads each rep got, for the reply and the notification. */
export function perRep(leads: LeadUpload[]): Record<string, number> {
  return leads.reduce<Record<string, number>>(
    (m, l) => ({ ...m, [l.rep_slug]: (m[l.rep_slug] ?? 0) + 1 }),
    {},
  );
}

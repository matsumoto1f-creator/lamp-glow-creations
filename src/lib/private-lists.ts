// Private lists: a staff member's own prospect lists (see the private_lists migration). Only the
// owner reads them; an admin gets nothing extra. This file is the part with no browser or
// database in it, so the tests can load it.
import { parseCsv } from "./engine-leads.ts";

export const ENTRY_STATUSES = [
  "new",
  "emailed",
  "called",
  "replied",
  "talking",
  "won",
  "dead",
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  new: "Not contacted",
  emailed: "Emailed",
  called: "Called",
  replied: "Replied",
  talking: "Talking",
  won: "Won",
  dead: "Dead",
};

export const TOUCH_KINDS = ["email", "call", "reply", "note"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];

export const TOUCH_LABEL: Record<TouchKind, string> = {
  email: "Email sent",
  call: "Call",
  reply: "Reply",
  note: "Note",
};

export type ListRow = { id: string; name: string; note: string | null; created_at: string };

export type EntryRow = {
  id: string;
  list_id: string;
  business: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  area: string | null;
  grp: string | null;
  notes: string;
  status: EntryStatus;
  position: number;
};

export type TouchRow = {
  id: number;
  entry_id: string;
  kind: TouchKind;
  happened_at: string;
  detail: string | null;
  to_address: string | null;
};

export const ENTRY_COLUMNS =
  "id,list_id,business,contact,phone,email,website,area,grp,notes,status,position";
export const TOUCH_COLUMNS = "id,entry_id,kind,happened_at,detail,to_address";

/** How two spellings of a business name are matched: case, spacing and edges don't count. */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A website cell as a link: "store.com" -> "https://store.com". Anything that isn't a web address -> null. */
export function siteHref(site: string | null): string | null {
  const s = (site ?? "").trim();
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(url);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Only a plain address becomes a mailto link. */
export const mailHref = (email: string | null): string | null => {
  const e = (email ?? "").trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? `mailto:${e}` : null;
};

/**
 * What logging something does to an entry's status. It only moves forward: an email to
 * someone already talking doesn't push them back to Emailed, and a note changes nothing.
 */
export function statusAfter(status: EntryStatus, kind: TouchKind): EntryStatus {
  const order: Record<EntryStatus, number> = {
    new: 0,
    emailed: 1,
    called: 2,
    replied: 3,
    talking: 4,
    won: 5,
    dead: 5,
  };
  const to: Partial<Record<TouchKind, EntryStatus>> = {
    email: "emailed",
    call: "called",
    reply: "replied",
  };
  const next = to[kind];
  return next && order[next] > order[status] ? next : status;
}

const cut = (v: string | undefined, max: number): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** The header names an import accepts for each field, lower case. */
const HEADERS: Record<string, readonly string[]> = {
  business: ["business", "store", "company", "name"],
  contact: ["contact", "owner", "owner_or_decision_maker", "decision_maker"],
  phone: ["phone"],
  email: ["email"],
  website: ["website", "site", "url"],
  area: ["area", "city", "location"],
  grp: ["group", "grp", "tier"],
  notes: ["notes", "note"],
  status: ["status"],
  emailed_at: ["emailed_at"],
  emailed_to: ["emailed_to"],
  emailed_subject: ["emailed_subject", "subject"],
};

export type ImportEntry = {
  business: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  area: string | null;
  grp: string | null;
  notes: string;
  status: EntryStatus | null;
  /** An email already sent to this business, to put in the log. */
  emailed: { at: string; to: string | null; subject: string | null } | null;
};

/** The most a single import takes: a hand-kept list, not a lead source. */
export const MAX_IMPORT = 500;

/**
 * Reads a CSV with a header row into entries. Only `business` is required. A row that can't be
 * used is left out and named in `problems`; the rest still come through. `emailed_at` should
 * carry its time zone (2026-11-10T12:03:00-05:00); without one it is read as this device's time.
 */
export function entriesFromCsv(text: string): { entries: ImportEntry[]; problems: string[] } {
  const rows = parseCsv(text);
  const head = rows[0];
  if (!head) return { entries: [], problems: ["The file is empty."] };
  const names = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const at = (field: string) => names.findIndex((n) => (HEADERS[field] ?? []).includes(n));
  const col = Object.fromEntries(Object.keys(HEADERS).map((f) => [f, at(f)])) as Record<
    string,
    number
  >;
  if ((col["business"] ?? -1) < 0)
    return { entries: [], problems: ['The first row needs a "business" column.'] };
  if (rows.length - 1 > MAX_IMPORT)
    return {
      entries: [],
      problems: [`At most ${MAX_IMPORT} rows per import; this file has ${rows.length - 1}.`],
    };
  const problems: string[] = [];
  const seen = new Set<string>();
  const entries: ImportEntry[] = [];
  rows.slice(1).forEach((r, i) => {
    const cell = (f: string) => ((col[f] ?? -1) >= 0 ? r[col[f] as number] : undefined);
    const line = `Row ${i + 2}`;
    const business = cut(cell("business"), 200);
    if (!business) return void problems.push(`${line}: no business name.`);
    if (seen.has(nameKey(business)))
      return void problems.push(`${line}: "${business}" is in the file twice.`);
    const rawStatus = (cell("status") ?? "").trim().toLowerCase();
    if (rawStatus && !(ENTRY_STATUSES as readonly string[]).includes(rawStatus))
      return void problems.push(
        `${line}: status "${rawStatus}" should be one of ${ENTRY_STATUSES.join(", ")}.`,
      );
    let emailed: ImportEntry["emailed"] = null;
    const when = (cell("emailed_at") ?? "").trim();
    if (when) {
      const t = new Date(when.includes("T") ? when : when.replace(" ", "T"));
      if (Number.isNaN(t.getTime()))
        return void problems.push(`${line}: emailed_at "${when}" isn't a date and time.`);
      emailed = {
        at: t.toISOString(),
        to: cut(cell("emailed_to"), 200) ?? cut(cell("email"), 200),
        subject: cut(cell("emailed_subject"), 2000),
      };
    }
    seen.add(nameKey(business));
    entries.push({
      business,
      contact: cut(cell("contact"), 200),
      phone: cut(cell("phone"), 40),
      email: cut(cell("email"), 200),
      website: cut(cell("website"), 300),
      area: cut(cell("area"), 200),
      grp: cut(cell("grp"), 80),
      notes: cut(cell("notes"), 4000) ?? "",
      status: (rawStatus as EntryStatus) || null,
      emailed,
    });
  });
  return { entries, problems };
}

export type ImportPlan = {
  /** Businesses not on the list yet, in file order. */
  add: ImportEntry[];
  /** Businesses already on the list: the id and only the fields the file fills in. */
  update: { id: string; business: string; fields: Partial<Omit<EntryRow, "id" | "list_id">> }[];
  /** Emails to log, by business name; one already in the log at that minute is left out. */
  log: { business: string; at: string; to: string | null; subject: string | null }[];
};

const minute = (iso: string) => new Date(iso).toISOString().slice(0, 16);

/**
 * Lines an import up against what the list already holds. A business already there (same name)
 * is updated, never doubled, and only where the file says something new: an empty cell never
 * wipes what is saved. Its status is left alone: that is the owner's own record of where things
 * stand.
 */
export function planImport(
  entries: ImportEntry[],
  existing: (Pick<EntryRow, "id" | "business"> & Partial<EntryRow>)[],
  touches: (Pick<TouchRow, "entry_id" | "kind" | "happened_at"> & { business?: string })[],
): ImportPlan {
  const byName = new Map(existing.map((e) => [nameKey(e.business), e]));
  const logged = new Set(
    touches.filter((t) => t.kind === "email").map((t) => `${t.entry_id} ${minute(t.happened_at)}`),
  );
  const plan: ImportPlan = { add: [], update: [], log: [] };
  for (const e of entries) {
    const have = byName.get(nameKey(e.business));
    if (!have) plan.add.push(e);
    else {
      const fields: ImportPlan["update"][number]["fields"] = {};
      // only what the file fills in and the list doesn't already say
      for (const k of ["contact", "phone", "email", "website", "area", "grp"] as const)
        if (e[k] && e[k] !== have[k]) fields[k] = e[k];
      if (e.notes && e.notes !== have.notes) fields.notes = e.notes;
      if (Object.keys(fields).length)
        plan.update.push({ id: have.id, business: have.business, fields });
    }
    if (e.emailed && !(have && logged.has(`${have.id} ${minute(e.emailed.at)}`)))
      plan.log.push({ business: e.business, ...e.emailed });
  }
  return plan;
}

/** The status a newly imported business starts with: the file's, or Emailed when it carries a sent email. */
export const importStatus = (e: ImportEntry): EntryStatus =>
  e.status ?? (e.emailed ? "emailed" : "new");

/** Group names in the order they first appear; entries with none go last under "Other". */
export function groupEntries<T extends { grp: string | null }>(
  entries: T[],
): { name: string; entries: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    const k = (e.grp ?? "").trim();
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const named = [...groups].filter(([k]) => k).map(([name, es]) => ({ name, entries: es }));
  const rest = groups.get("");
  return rest ? [...named, { name: named.length ? "Other" : "", entries: rest }] : named;
}

/** Whether an entry matches what was typed in the search box. */
export function matches(
  e: Pick<EntryRow, "business" | "contact" | "area" | "email" | "phone">,
  term: string,
): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [e.business, e.contact, e.area, e.email, e.phone].some((v) =>
    (v ?? "").toLowerCase().includes(t),
  );
}

/** How many entries sit in each status, for the line under the list's name. */
export function statusCounts(entries: Pick<EntryRow, "status">[]): Record<EntryStatus, number> {
  const out = Object.fromEntries(ENTRY_STATUSES.map((s) => [s, 0])) as Record<EntryStatus, number>;
  for (const e of entries) out[e.status] += 1;
  return out;
}

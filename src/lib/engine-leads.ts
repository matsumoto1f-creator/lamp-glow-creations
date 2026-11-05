/** Engine leads: statuses, labels and the small helpers the staff view and tests share. */

export const ENGINE_STATUSES = [
  "new",
  "called",
  "no_answer",
  "callback",
  "qualified",
  "submitted",
  "funded",
  "dead",
  "do_not_call",
] as const;
export type EngineStatus = (typeof ENGINE_STATUSES)[number];

export const ENGINE_STATUS_LABEL: Record<EngineStatus, string> = {
  new: "New",
  called: "Called",
  no_answer: "No answer",
  callback: "Callback",
  qualified: "Qualified",
  submitted: "Submitted",
  funded: "Funded",
  dead: "Dead",
  do_not_call: "Do not call",
};

export const TIERS = ["A", "B", "C"] as const;

type Signal = { source?: string; signal_type?: string; signal_date?: string; detail?: string };

/** "nyc_license 2026-10-12 · fmcsa 2026-10-03": what the engine saw, newest first. */
export function signalSummary(signals: unknown): string {
  if (!Array.isArray(signals)) return "";
  return (signals as Signal[])
    .filter((s) => s && typeof s === "object")
    .map((s) => [s.source, s.signal_type, s.signal_date].filter(Boolean).join(" "))
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
}

export const LEAD_TYPES = ["fleet", "contractor", "auto", "ucc"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];
export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  fleet: "Fleet",
  contractor: "Contractor",
  auto: "Auto shop",
  ucc: "UCC",
};

const signalTypes = (signals: unknown): Set<string> =>
  new Set(
    Array.isArray(signals)
      ? (signals as Signal[]).map((s) => (s && typeof s === "object" ? (s.signal_type ?? "") : ""))
      : [],
  );

/**
 * Which kind of lead this is, read from what the engine saw, in the order the engine's push picks
 * them: an established trucking fleet, else a contractor (NYC permit or license, NJ home
 * improvement registration), else an auto repair shop, else a merchant known only from a UCC filing.
 */
export function leadType(signals: unknown): LeadType | null {
  const t = signalTypes(signals);
  if (t.has("fmcsa_established")) return "fleet";
  if (t.has("nyc_permit") || t.has("nyc_license") || t.has("nj_hic")) return "contractor";
  if (t.has("nj_auto_facility")) return "auto";
  if (t.has("mca_ucc")) return "ucc";
  return null;
}

/** A UCC filing by an MCA funder is on record: this merchant has taken an advance before. */
export const tookMca = (signals: unknown) => signalTypes(signals).has("mca_ucc");

export const tel = (phone: string | null) => (phone ?? "").replace(/[^0-9+]/g, "");

/** Plain names for the public records the engine reads. */
const RECORD_LABEL: Record<string, string> = {
  nyc_permit: "NYC building permit",
  nyc_license: "NYC business license",
  fmcsa_established: "Federal trucking registration (FMCSA)",
  nj_auto_facility: "NJ auto facility license",
  nj_hic: "NJ home improvement contractor registration",
  mca_ucc: "UCC-1 filed by an MCA funder",
};

export type LeadRecord = { label: string; date: string | null; detail: string | null };

/**
 * Every public record behind a lead, newest first, once each: what it is, when, and what it said
 * (the engine sends a detail line such as "1 permitted job(s) since 2026-10-22, $56,000
 * estimated; Plumbing"; older pushes have none).
 */
export function leadRecords(signals: unknown): LeadRecord[] {
  if (!Array.isArray(signals)) return [];
  const seen = new Set<string>();
  const out: LeadRecord[] = [];
  for (const s of signals as Signal[]) {
    if (!s || typeof s !== "object") continue;
    const type = String(s.signal_type ?? "");
    const label = RECORD_LABEL[type] ?? (type || String(s.source ?? "")).replace(/_/g, " ");
    if (!label) continue;
    const date = typeof s.signal_date === "string" && s.signal_date ? s.signal_date : null;
    const detail = typeof s.detail === "string" && s.detail.trim() ? s.detail.trim() : null;
    const key = `${label}|${date}|${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, date, detail });
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export type LeadWhy = {
  owner: string | null;
  ownerFrom: string | null;
  alsoOwner: string | null;
  points: { text: string; means: string | null }[];
};

// What each part of the engine's reason line tells a rep. The engine writes "(PPP loan)"; the
// program is shown as PPP so reps don't carry the word into an MCA call.
const POINT_MEANS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^operating in 2020-21/i,
    () => "It was open and running in 2020-21, so it isn't a new business.",
  ],
  [
    /PPP payroll \$([\d,]+)\/mo/i,
    (m) => `Payroll it reported for PPP, about $${m[1]} a month: a rough idea of its size.`,
  ],
  [/\$([\d,]+) of permitted work/i, () => "Estimated value of the jobs on its permits."],
  [/^FMCSA registered (\d{4})/i, (m) => `A registered trucking company since ${m[1]}.`],
  [/^(\d+) trucks?$/i, (m) => `${m[1]} trucks on its federal registration.`],
  [/license since (\d{4})/i, (m) => `Licensed by the city since ${m[1]}.`],
  [/UCC|MCA/i, () => "A funder filed a lien for an advance: it has taken an MCA before."],
];

/**
 * The engine's reason line, taken apart: "Owner: Name (where the name came from); also Other ·
 * point · point". The owner leads the line because Lamp has no owner column.
 */
export function splitWhy(reason: string | null): LeadWhy {
  const parts = (reason ?? "")
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean);
  let owner: string | null = null;
  let ownerFrom: string | null = null;
  let alsoOwner: string | null = null;
  if (parts[0]?.startsWith("Owner:")) {
    const m = parts
      .shift()!
      .slice(6)
      .trim()
      .match(/^(.+?)(?: \(([^)]*)\))?(?:; also (.+))?$/);
    if (m) {
      owner = m[1]?.trim() || null;
      ownerFrom = m[2]?.trim() || null;
      alsoOwner = m[3]?.trim() || null;
    }
  }
  const points = parts
    // "has phone" holds for every lead here, and a bare tag ("contractor") repeats the industry
    .filter((p) => p.toLowerCase() !== "has phone" && !/^[a-z][a-z ]{0,24}$/.test(p))
    .map((p) => {
      const text = p.replace(/\(PPP loan\)/gi, "(PPP)");
      const hit = POINT_MEANS.find(([re]) => re.test(p));
      return { text, means: hit ? hit[1](p.match(hit[0])!) : null };
    });
  return { owner, ownerFrom, alsoOwner, points };
}

/** Why this kind of business needs working capital, and a first question that opens it up. */
export const LEAD_APPROACH: Record<LeadType, { why: string; ask: string }> = {
  contractor: {
    why: "It has permitted work going on now. Contractors pay for materials, crew and equipment up front and get paid when the customer pays, so cash runs tight between payments.",
    ask: "Ask about the job on the permit: how they're covering materials and payroll until the customer pays.",
  },
  fleet: {
    why: "Trucking runs on fuel, insurance, repairs and weekly driver pay, while brokers and shippers pay in 30 to 60 days.",
    ask: "Ask how many trucks are running right now and how long their customers take to pay.",
  },
  auto: {
    why: "A licensed shop with bays, parts and equipment to keep busy. Slow months and big equipment buys hit its cash hardest.",
    ask: "Ask what equipment they'd add, or how they get through a slow month.",
  },
  ucc: {
    why: "A funder filed a lien for an advance, so it has taken an MCA before: the owner knows how it works and qualified once.",
    ask: "Ask how that advance went and whether they could use more, or better terms on the next one.",
  },
};

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** The columns of the CSV the Board downloads for Lamp, in its order. */
export const COLUMNS = [
  "source",
  "source_key",
  "name",
  "phone",
  "email",
  "city",
  "state",
  "industry",
  "tier",
  "need",
  "reason",
  "signals",
  "first_found",
  "rep_slug",
] as const;
type Column = (typeof COLUMNS)[number];

/** One row of the CSV the Board downloads for Lamp, ready to upsert by (source, source_key). */
export type LeadUpload = {
  source: string;
  source_key: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  tier: string | null;
  need: number | null;
  reason: string | null;
  signals: unknown[];
  first_found: string | null;
  rep_slug: string;
};

/**
 * Reads the Board's CSV. Every lead needs a source and key, and a rep: the file's rep_slug
 * column, or `rep` when the admin picks one rep for the whole file. Rows that can't be used
 * are listed in `problems` with their line number and left out.
 */
export function leadsFromCsv(
  text: string,
  repSlugs: string[],
  rep: string | null,
): { leads: LeadUpload[]; problems: string[] } {
  const [head, ...body] = parseCsv(text);
  const problems: string[] = [];
  if (!head) return { leads: [], problems: ["The file is empty."] };
  const at = {} as Record<Column, number>;
  for (const k of COLUMNS) at[k] = head.findIndex((h) => h.trim().toLowerCase() === k);
  if (at.source < 0 || at.source_key < 0) {
    return {
      leads: [],
      problems: ["This isn't a Lamp lead file: it has no source and source_key columns."],
    };
  }
  const seen = new Set<string>();
  const leads: LeadUpload[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const v = (k: Column) => (at[k] >= 0 ? (r[at[k]] ?? "").trim() : "");
    const orNull = (k: Column) => v(k) || null;
    const source = v("source");
    const key = v("source_key");
    if (!source || !key) {
      problems.push(`Line ${line}: no source or source_key.`);
      return;
    }
    if (seen.has(`${source}\u0000${key}`)) {
      problems.push(`Line ${line}: the same lead appears twice in the file.`);
      return;
    }
    const slug = (rep ?? v("rep_slug")).toLowerCase();
    if (!slug || !repSlugs.includes(slug)) {
      problems.push(
        `Line ${line}: ${slug ? `"${slug}" is not a Lamp rep` : "no rep"} (${v("name") || key}).`,
      );
      return;
    }
    const tier = v("tier").toUpperCase();
    if (tier && !["A", "B", "C", "X"].includes(tier)) {
      problems.push(`Line ${line}: tier "${tier}" should be A, B, C or X.`);
      return;
    }
    const need = v("need");
    let signals: unknown[] = [];
    if (v("signals")) {
      try {
        const parsed: unknown = JSON.parse(v("signals"));
        signals = Array.isArray(parsed) ? parsed : [];
      } catch {
        problems.push(
          `Line ${line}: the signals column isn't valid JSON; uploaded without signals.`,
        );
      }
    }
    const found = v("first_found");
    seen.add(`${source}\u0000${key}`);
    leads.push({
      source,
      source_key: key,
      name: orNull("name"),
      phone: orNull("phone"),
      email: orNull("email"),
      city: orNull("city"),
      state: orNull("state"),
      industry: orNull("industry"),
      tier: tier || null,
      need: /^-?\d+$/.test(need) ? Number(need) : null,
      reason: orNull("reason"),
      signals,
      first_found: /^\d{4}-\d{2}-\d{2}$/.test(found.slice(0, 10)) ? found.slice(0, 10) : null,
      rep_slug: slug,
    });
  });
  return { leads, problems };
}

/**
 * The search box as a PostgREST `or` filter over name, phone, email, city and industry, or null
 * for an empty box. Characters that mean something to the filter are dropped; a term that is
 * all digits and dashes also matches phones however they're written ("7185551212" finds
 * "(718) 555-1212").
 */
export function searchFilter(term: string): string | null {
  const t = term
    .replace(/[^\p{L}\p{N} @.&'_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  const like = `%${t}%`;
  const parts = ["name", "email", "city", "industry"].map((c) => `${c}.ilike."${like}"`);
  const digits = t.replace(/\D/g, "");
  parts.push(
    /^[\d\s-]+$/.test(t) && digits.length >= 3
      ? `phone.ilike."%${digits.split("").join("%")}%"`
      : `phone.ilike."${like}"`,
  );
  return parts.join(",");
}

/** One engine lead as the page shows it, for the admin's CSV download. */
export type LeadExport = {
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  tier: string | null;
  need: number | null;
  reason: string | null;
  signals: unknown;
  first_found: string | null;
  status: string;
  notes: string;
  rep_slug: string | null;
  worked_at: string | null;
};

/**
 * The picked leads as a CSV that opens in Excel or Sheets: a byte-order mark for the accents,
 * and a cell that starts like a formula (=, +, -, @) gets a leading apostrophe so a
 * spreadsheet shows it as text instead of running it.
 */
export function leadsToCsv(rows: LeadExport[], repName: (slug: string | null) => string): string {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    "Business",
    "Phone",
    "Email",
    "City",
    "State",
    "Industry",
    "Tier",
    "Need",
    "Why",
    "Signals",
    "Found",
    "Status",
    "Notes",
    "Rep",
    "Last worked",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.phone,
      r.email,
      r.city,
      r.state,
      r.industry,
      r.tier,
      r.need,
      r.reason,
      signalSummary(r.signals),
      r.first_found,
      ENGINE_STATUS_LABEL[r.status as EngineStatus] ?? r.status,
      r.notes,
      repName(r.rep_slug),
      r.worked_at ? r.worked_at.slice(0, 10) : "",
    ]
      .map(cell)
      .join(","),
  );
  return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}

/**
 * The Board (Asad's War Room, which runs on his own Mac) can hand a batch of leads to an
 * admin's open Engine leads page instead of a downloaded file. It opens this page, waits for
 * "ready", then sends the same CSV it would have downloaded; nothing is saved until the admin
 * presses Hand out, under their own sign-in. Only these origins are listened to, and only from
 * the window that opened this one.
 */
export const BOARD_ORIGINS = ["http://localhost:8777", "http://127.0.0.1:8777"] as const;
export const BOARD_MAX_CSV = 2_000_000;

export type BoardBatch = { batch: number; label: string; csv: string };

/** A message from the Board, if it is a well-formed batch of leads. */
export function boardBatch(data: unknown): BoardBatch | null {
  if (!data || typeof data !== "object") return null;
  const {
    type,
    batch,
    csv,
    label: rawLabel,
  } = data as {
    type?: unknown;
    batch?: unknown;
    csv?: unknown;
    label?: unknown;
  };
  if (type !== "lamp-board:leads") return null;
  if (typeof batch !== "number" || !Number.isInteger(batch) || batch <= 0) return null;
  if (typeof csv !== "string" || !csv || csv.length > BOARD_MAX_CSV) return null;
  const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, 120) : "";
  return { batch, label: label || `Board batch #${batch}`, csv };
}

// Find anything on the staff page (Asad, 2026-11-25: "no matter what i search related to the lead
// like a phone number or email or business name ... nothing pops up", and "on every page a lead
// opens up to i should be able to click it and it opens to all the info we have on it").
// One box searches every record a person can see: files, engine leads, application links and
// website leads. Each result opens the fullest record there is for it. No imports, so the tests
// can load it.

/** The term with anything PostgREST's filter syntax would read as structure taken out. */
export function cleanTerm(term: string): string {
  return term
    .replace(/[^\p{L}\p{N} @.&'_+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the term is a phone number as typed: digits, spaces, dashes, dots, brackets, plus. */
export const looksLikePhone = (term: string) =>
  /^[\d\s().+-]+$/.test(term) && term.replace(/\D/g, "").length >= 3;

/**
 * The digits of a phone number to look for. A leading US 1 is dropped from an 11-digit number, so
 * "+1 718 923 2893" finds a row saved as "(718) 923-2893".
 */
export function phoneDigits(term: string): string {
  const d = term.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * A PostgREST `or` filter matching the term in any of the text columns, or, for a phone number,
 * in any phone column however it was punctuated ("7189232893" finds "(718) 923-2893"). Null when
 * there is nothing to search for (fewer than two characters).
 */
export function orFilter(
  term: string,
  textCols: readonly string[],
  phoneCols: readonly string[],
): string | null {
  const t = cleanTerm(term);
  if (t.length < 2) return null;
  if (looksLikePhone(t)) {
    const pattern = `%${phoneDigits(t).split("").join("%")}%`;
    return phoneCols.map((c) => `${c}.ilike."${pattern}"`).join(",");
  }
  return [...textCols, ...phoneCols].map((c) => `${c}.ilike."%${t}%"`).join(",");
}

/** What each kind of record is searched on. Columns a person can't see stay out. */
export const FIND_COLUMNS = {
  file: { text: ["business_name", "first_name", "email"], phone: ["phone"] },
  engine: {
    text: ["name", "email", "contact_name", "contact_email", "city"],
    phone: ["phone", "contact_phone"],
  },
  link: { text: ["business_name", "first_name", "last_name", "email"], phone: ["phone"] },
  website: { text: ["first_name", "email"], phone: ["phone"] },
} as const;

export type FindKind = keyof typeof FIND_COLUMNS;

/** Where a record opens on the staff page, as its search object. */
export type RecordSearch = {
  file?: string;
  view?: "engine" | "sent";
  elead?: number;
  lead?: string;
  invite?: string;
};

/**
 * The fullest record there is for something: its file when it has one (the whole application,
 * documents, offers, notes and calls), else its engine lead (number, status, callback, notes),
 * else the website lead, else the application link itself. Null when there is nothing to open.
 */
export function recordSearch(ids: {
  file?: string | null;
  elead?: number | null;
  lead?: string | null;
  invite?: string | null;
}): RecordSearch | null {
  if (ids.file) return { file: ids.file };
  if (ids.elead != null) return { view: "engine", elead: ids.elead };
  if (ids.lead) return { lead: ids.lead };
  if (ids.invite) return { view: "sent", invite: ids.invite };
  return null;
}

export type FindResult = {
  kind: FindKind;
  key: string;
  title: string;
  /** "Engine lead · Callback", "File · Docs needed" */
  label: string;
  /** a phone or email to tell two results apart */
  detail: string;
  open: RecordSearch;
};

export const KIND_LABEL: Record<FindKind, string> = {
  file: "File",
  engine: "Engine lead",
  link: "Application link",
  website: "Website lead",
};

/** Files first, then engine leads, application links and website leads. */
export const KIND_ORDER: readonly FindKind[] = ["file", "engine", "link", "website"];

/** "Asad" or "Gaudioso Contracting Inc", whichever the record has. */
export const titleOf = (...parts: (string | null | undefined)[]) =>
  parts.map((p) => (p ?? "").trim()).find(Boolean) ?? "No name";

/** The phone and email of a record, as one short line. */
export const detailOf = (phone: string | null | undefined, email: string | null | undefined) =>
  [phone, email]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" · ");

// Messages between a merchant and Lamp (supabase/migrations/20261109120000_chat_merchant_threads.sql).
// The wording and the checks, with no imports so the deno tests load this file directly.

/** How often an open conversation looks for new messages. */
export const POLL_MS = 15_000;

/** The most messages a conversation loads at once (newest kept). */
export const PAGE = 200;

export const MAX_LENGTH = 4000;

export type ChatMessage = {
  id: number;
  kind: "text" | "document" | "system";
  body: string;
  author: string | null;
  author_role: "merchant" | "rep" | "admin" | "system";
  author_name: string | null;
  document_id: string | null;
  created_at: string;
  redacted_at: string | null;
};

export const MESSAGE_COLUMNS =
  "id,kind,body,author,author_role,author_name,document_id,created_at,redacted_at";

/**
 * The same numbers the database refuses (chat_text_refused): an SSN with dashes or spaces, an EIN,
 * a card number, or 8 or more digits in a row. A phone number written with dashes passes.
 */
const REFUSED = [
  /(^|[^0-9])[0-9]{3}[- ][0-9]{2}[- ][0-9]{4}([^0-9]|$)/,
  /(^|[^0-9])[0-9]{2}-[0-9]{7}([^0-9]|$)/,
  /(^|[^0-9])[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}([^0-9]|$)/,
  /[0-9]{8,}/,
];

export const REFUSED_TEXT =
  "Please don't send account, card or Social Security numbers in chat. Your rep will send you a secure link for those. Phone numbers are fine written like 201-555-0123.";

/** Why a message can't be sent as written, or null when it can. */
export function chatRefusal(body: string): string | null {
  const text = body.trim();
  if (!text) return "Write a message first.";
  if (text.length > MAX_LENGTH)
    return `Keep a message under ${MAX_LENGTH.toLocaleString()} characters.`;
  if (REFUSED.some((re) => re.test(text))) return REFUSED_TEXT;
  return null;
}

/**
 * Words that describe a merchant cash advance as lending. Staff see a warning before sending one
 * to a merchant; a merchant's own words are never checked.
 */
const LENDING = /\b(loans?|lend(?:er|ers|ing)?|borrow(?:er|ers|ing|ed)?|interest rates?|APR)\b/gi;

/** The lending words in a staff message, each once, as typed. */
export function lendingWords(body: string): string[] {
  const seen = new Map<string, string>();
  for (const m of body.matchAll(LENDING)) {
    const k = m[0].toLowerCase();
    if (!seen.has(k)) seen.set(k, m[0]);
  }
  return [...seen.values()];
}

export const firstName = (name: string | null | undefined) =>
  (name ?? "").trim().split(/\s+/)[0] || "";

type RepRow = { slug: string; name: string; admin_slug?: string | null };

/**
 * Who the merchant is talking to, as the application emails and the signed PDF already name them:
 * the rep's team lead when the rep has one, otherwise the rep. An unassigned file: the Lamp team.
 */
export function contactName(repSlug: string | null | undefined, reps: RepRow[]): string {
  if (!repSlug) return "the Lamp team";
  const rep = reps.find((r) => r.slug === repSlug);
  if (!rep) return "the Lamp team";
  const lead = rep.admin_slug ? reps.find((r) => r.slug === rep.admin_slug) : undefined;
  return firstName(lead?.name ?? rep.name) || "the Lamp team";
}

/** The name over a message, for whoever is reading. */
export function authorLabel(
  m: Pick<ChatMessage, "author" | "author_role" | "author_name">,
  viewer: "merchant" | "staff",
  me: string,
): string {
  if (m.author && m.author === me) return "You";
  if (m.author_role === "system") return "Lamp";
  if (viewer === "merchant") {
    if (m.author_role === "merchant") return firstName(m.author_name) || "You";
    return `${firstName(m.author_name) || "Lamp"} at Lamp`;
  }
  if (m.author_role === "merchant") return `${m.author_name || "Merchant"} (merchant)`;
  return m.author_name || "Lamp";
}

/** A short time for a message: "2:14 PM" today, "Nov 8, 2:14 PM" before. */
export function messageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** What to show when the database refused a message. Its own words for the refusals it explains. */
export function chatError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return "";
  if ((err.code === "22023" || err.code === "42501") && err.message) return err.message;
  return "That didn't send. Check your connection and try again.";
}

/** The conversation's tables or functions aren't in this database yet (their SQL hasn't run). */
export const chatMissing = (err: { code?: string } | null | undefined) =>
  !!err && ["PGRST202", "PGRST205", "42P01", "42883"].includes(err.code ?? "");

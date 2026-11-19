/**
 * Rep agreements: the documents a staff member signs before using the staff page (Stevie,
 * 2026-11-19). Plain logic shared by the page, the server and the tests; no database calls here.
 *
 * A document has a key ("rep-agreement") and numbered versions. The one in force is the newest
 * published version of each key, unless that key is switched off (retired). Everyone who is not
 * an admin signs every document in force; a new version asks them again.
 */

export type RepDocument = {
  id: string;
  doc_key: string;
  version: number;
  title: string;
  body: string;
  body_sha256: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  retired_at: string | null;
};

export type RepSignature = {
  id: string;
  document_id: string;
  user_id: string;
  signer_email: string | null;
  typed_name: string;
  body_sha256: string;
  signed_at: string;
};

/** A seat on the team, for checking who has signed (admins only see this). */
export type RepPerson = {
  user_id: string | null;
  name: string;
  is_admin: boolean;
  active: boolean;
};

export const DOC_COLUMNS =
  "id,doc_key,version,title,body,body_sha256,created_at,updated_at,published_at,retired_at";
export const SIGNATURE_COLUMNS =
  "id,document_id,user_id,signer_email,typed_name,body_sha256,signed_at";

export const MAX_TITLE = 120;
export const MAX_BODY = 100_000;

/** The version in force for each document: its newest published one, unless switched off. */
export function inForce(docs: readonly RepDocument[]): RepDocument[] {
  const newest = new Map<string, RepDocument>();
  for (const d of docs) {
    if (!d.published_at) continue;
    const had = newest.get(d.doc_key);
    if (!had || d.version > had.version) newest.set(d.doc_key, d);
  }
  return [...newest.values()]
    .filter((d) => !d.retired_at)
    .sort(
      (a, b) =>
        (a.published_at ?? "").localeCompare(b.published_at ?? "") ||
        a.doc_key.localeCompare(b.doc_key),
    );
}

/** What this person still has to sign, in order. Admins sign nothing. */
export function toSign(
  docs: readonly RepDocument[],
  mine: readonly Pick<RepSignature, "document_id">[],
  isAdmin: boolean,
): RepDocument[] {
  if (isAdmin) return [];
  const signed = new Set(mine.map((s) => s.document_id));
  return inForce(docs).filter((d) => !signed.has(d.id));
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Why a typed signature can't be accepted, or null when it can. */
export function signatureProblem(typed: string, agreed: boolean): string | null {
  if (!agreed) return "Tick the box to say you agree.";
  const name = clean(typed);
  if (!name) return "Type your full name to sign.";
  if (name.length > MAX_TITLE) return "That name is too long.";
  const words = name.split(" ").filter((w) => /\p{L}/u.test(w));
  if (words.length < 2) return "Type your first and last name.";
  return null;
}

/** The typed name as it is stored: single spaces, no ends. */
export const signedName = clean;

/** "Rep Agreement" -> "rep-agreement", a key for a new document. */
export function keyFromTitle(title: string): string {
  const k = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return k.length >= 2 ? k : "document";
}

/** A key not already used, adding -2, -3 ... */
export function freeKey(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = keyFromTitle(title);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const k = `${base.slice(0, 40 - String(n).length - 1)}-${n}`;
    if (!used.has(k)) return k;
  }
}

/** The version number a new draft of this document gets. */
export function nextVersion(docs: readonly RepDocument[], key: string): number {
  return docs.filter((d) => d.doc_key === key).reduce((m, d) => Math.max(m, d.version), 0) + 1;
}

/** Why a draft can't be saved, or null. */
export function draftProblem(title: string, body: string): string | null {
  if (!title.trim()) return "Give the document a title.";
  if (title.trim().length > MAX_TITLE) return `Keep the title under ${MAX_TITLE} characters.`;
  if (!body.trim()) return "Paste the document's text.";
  if (body.length > MAX_BODY) return "That text is too long for one document.";
  return null;
}

/** Text normalised the same way on save and on publish, so the hash matches what was shown. */
export const normaliseBody = (body: string) => body.replace(/\r\n?/g, "\n").trim();

const day = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

/** A plain-text copy to keep: the document, and the signature when there is one. */
export function signedCopy(
  doc: RepDocument,
  sig?: Pick<RepSignature, "typed_name" | "signed_at" | "signer_email"> | null,
): string {
  const lines = [
    doc.title,
    `Version ${doc.version}${doc.published_at ? `, published ${day(doc.published_at)}` : " (draft)"}`,
    "",
    doc.body,
    "",
    "----",
  ];
  if (sig) {
    lines.push(
      `Signed electronically by ${sig.typed_name}${sig.signer_email ? ` (${sig.signer_email})` : ""}`,
      `on ${day(sig.signed_at)}.`,
    );
  } else {
    lines.push("Not signed.");
  }
  if (doc.body_sha256) lines.push(`Text fingerprint (SHA-256): ${doc.body_sha256}`);
  return lines.join("\n") + "\n";
}

/** "rep-agreement-v2.txt" */
export const copyFileName = (doc: Pick<RepDocument, "doc_key" | "version">) =>
  `${doc.doc_key}-v${doc.version}.txt`;

/** For the Team tab: who has signed the version in force, and who hasn't yet. */
export function signingStatus(
  doc: RepDocument,
  people: readonly RepPerson[],
  sigs: readonly RepSignature[],
): { name: string; signed: RepSignature | null; waiting: boolean }[] {
  const byUser = new Map(sigs.filter((s) => s.document_id === doc.id).map((s) => [s.user_id, s]));
  return people
    .filter((p) => p.active && !p.is_admin)
    .map((p) => {
      const signed = p.user_id ? (byUser.get(p.user_id) ?? null) : null;
      return { name: p.name, signed, waiting: !p.user_id };
    })
    .sort((a, b) => Number(!!a.signed) - Number(!!b.signed) || a.name.localeCompare(b.name));
}

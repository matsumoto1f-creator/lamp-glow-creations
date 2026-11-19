// deno test --node-modules-dir=none tests/rep-documents.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  copyFileName,
  draftProblem,
  freeKey,
  inForce,
  keyFromTitle,
  nextVersion,
  normaliseBody,
  signatureProblem,
  signedCopy,
  signedName,
  signingStatus,
  toSign,
  type RepDocument,
  type RepSignature,
} from "../src/lib/rep-documents.ts";
import migration from "../supabase/migrations/20261119120000_rep_documents.sql" with { type: "text" };
import server from "../src/lib/rep-documents.server.ts" with { type: "text" };
import staff from "../src/routes/staff.tsx" with { type: "text" };

const HASH = "a".repeat(64);
const doc = (
  o: Partial<RepDocument> & Pick<RepDocument, "id" | "doc_key" | "version">,
): RepDocument => ({
  title: "Rep Agreement",
  body: "Text.",
  body_sha256: HASH,
  created_at: "2026-11-19T10:00:00Z",
  updated_at: "2026-11-19T10:00:00Z",
  published_at: "2026-11-19T12:00:00Z",
  retired_at: null,
  ...o,
});
const sig = (
  document_id: string,
  user_id: string,
  extra: Partial<RepSignature> = {},
): RepSignature => ({
  id: `${document_id}-${user_id}`,
  document_id,
  user_id,
  signer_email: null,
  typed_name: "Dana Rep",
  body_sha256: HASH,
  signed_at: "2026-11-19T13:00:00Z",
  ...extra,
});

Deno.test("in force: the newest published version of each document, unless switched off", () => {
  const docs = [
    doc({ id: "a1", doc_key: "rep-agreement", version: 1 }),
    doc({ id: "a2", doc_key: "rep-agreement", version: 2, published_at: "2026-11-20T12:00:00Z" }),
    doc({ id: "a3", doc_key: "rep-agreement", version: 3, published_at: null, body_sha256: null }),
    doc({ id: "c1", doc_key: "confidentiality", version: 1, published_at: "2026-11-18T09:00:00Z" }),
    doc({ id: "x1", doc_key: "old-policy", version: 1, retired_at: "2026-11-19T14:00:00Z" }),
  ];
  // the draft (a3) is not in force, v2 replaces v1, the retired key is gone; oldest published first
  assertEquals(
    inForce(docs).map((d) => d.id),
    ["c1", "a2"],
  );
  assertEquals(inForce([]), []);
});

Deno.test(
  "to sign: what this person hasn't signed; a new version asks again; admins sign nothing",
  () => {
    const v1 = doc({ id: "a1", doc_key: "rep-agreement", version: 1 });
    const v2 = doc({
      id: "a2",
      doc_key: "rep-agreement",
      version: 2,
      published_at: "2026-11-20T00:00:00Z",
    });
    assertEquals(
      toSign([v1], [], false).map((d) => d.id),
      ["a1"],
    );
    assertEquals(toSign([v1], [sig("a1", "u")], false), []);
    // v2 is published: having signed v1 is not enough
    assertEquals(
      toSign([v1, v2], [sig("a1", "u")], false).map((d) => d.id),
      ["a2"],
    );
    assertEquals(toSign([v1, v2], [], true), []);
    // nothing published: nobody is stopped
    assertEquals(
      toSign([doc({ id: "d", doc_key: "k1", version: 1, published_at: null })], [], false),
      [],
    );
  },
);

Deno.test("signature: a ticked box and a first and last name", () => {
  assertEquals(signatureProblem("Dana Rep", false), "Tick the box to say you agree.");
  assertEquals(signatureProblem("   ", true), "Type your full name to sign.");
  assertEquals(signatureProblem("Dana", true), "Type your first and last name.");
  assertEquals(signatureProblem("D .", true), "Type your first and last name.");
  assertEquals(signatureProblem("x".repeat(121) + " y", true), "That name is too long.");
  assertEquals(signatureProblem("  Dana   Rep ", true), null);
  assertEquals(signatureProblem("José Núñez", true), null);
  assertEquals(signedName("  Dana   Rep "), "Dana Rep");
});

Deno.test("keys and versions for new documents", () => {
  assertEquals(keyFromTitle("Independent Sales Rep Agreement"), "independent-sales-rep-agreement");
  assertEquals(keyFromTitle("!!"), "document");
  assert(keyFromTitle("a".repeat(80)).length <= 40);
  assertEquals(freeKey("Rep Agreement", ["rep-agreement"]), "rep-agreement-2");
  assertEquals(freeKey("Rep Agreement", ["rep-agreement", "rep-agreement-2"]), "rep-agreement-3");
  assert(/^[a-z0-9][a-z0-9-]{1,40}$/.test(freeKey("a".repeat(80), ["a".repeat(40)])));
  const docs = [
    doc({ id: "1", doc_key: "k1", version: 1 }),
    doc({ id: "2", doc_key: "k1", version: 2 }),
  ];
  assertEquals(nextVersion(docs, "k1"), 3);
  assertEquals(nextVersion(docs, "k2"), 1);
});

Deno.test(
  "drafts: a title and text are needed; line endings are made the same before hashing",
  () => {
    assertEquals(draftProblem("", "x"), "Give the document a title.");
    assertEquals(draftProblem("T", "  "), "Paste the document's text.");
    assertEquals(draftProblem("T", "x"), null);
    assertEquals(normaliseBody("  a\r\nb\rc  \n"), "a\nb\nc");
  },
);

Deno.test("a copy to keep names the version, the signer and the fingerprint", () => {
  const d = doc({ id: "a1", doc_key: "rep-agreement", version: 2, body: "Clause one." });
  const unsigned = signedCopy(d);
  assert(unsigned.startsWith("Rep Agreement\nVersion 2, published "));
  assert(unsigned.includes("Clause one."));
  assert(unsigned.includes("Not signed."));
  assert(unsigned.includes(`SHA-256): ${HASH}`));
  const signed = signedCopy(d, {
    typed_name: "Dana Rep",
    signed_at: "2026-11-19T13:00:00Z",
    signer_email: "dana@example.com",
  });
  assert(signed.includes("Signed electronically by Dana Rep (dana@example.com)"));
  assertEquals(copyFileName(d), "rep-agreement-v2.txt");
});

Deno.test("who has signed: active non-admins only, unsigned first", () => {
  const d = doc({ id: "a1", doc_key: "rep-agreement", version: 1 });
  const people = [
    { user_id: "u1", name: "Zed Signed", is_admin: false, active: true },
    { user_id: "u2", name: "Amy Waiting", is_admin: false, active: true },
    { user_id: null, name: "New Person", is_admin: false, active: true },
    { user_id: "u3", name: "Boss Admin", is_admin: true, active: true },
    { user_id: "u4", name: "Gone Rep", is_admin: false, active: false },
  ];
  const rows = signingStatus(d, people, [sig("a1", "u1"), sig("other", "u2")]);
  assertEquals(
    rows.map((r) => [r.name, !!r.signed, r.waiting]),
    [
      ["Amy Waiting", false, false],
      ["New Person", false, true],
      ["Zed Signed", true, false],
    ],
  );
});

Deno.test(
  "the database keeps what was signed: fixed versions, permanent signatures, no browser writes",
  () => {
    const sql = migration.toLowerCase();
    // a published version can't be edited or deleted, a signature can't be changed or deleted
    assert(sql.includes("a published document cannot be changed"));
    assert(sql.includes("a published document is kept for the record and cannot be deleted"));
    assert(sql.includes("before update or delete on public.rep_document_signatures"));
    // only a published version, with its own fingerprint, can be signed
    assert(sql.includes("that document is a draft and cannot be signed"));
    assert(sql.includes("new.body_sha256 is distinct from d.body_sha256"));
    // no write policy and writes revoked from the browser roles
    assert(!/for (insert|update|delete|all)/.test(sql));
    assert(
      sql.includes(
        "revoke insert, update, delete, truncate on public.rep_documents from anon, authenticated",
      ),
    );
    assert(
      sql.includes(
        "revoke insert, update, delete, truncate on public.rep_document_signatures from anon, authenticated",
      ),
    );
    // a deleted login doesn't take its signatures with it
    assert(!/user_id uuid not null references auth\.users/.test(sql));
  },
);

Deno.test("the server signs only the version in force, and only admins change documents", () => {
  const signAt = server.indexOf('body.action === "sign"');
  const adminAt = server.indexOf("if (!isAdmin) return json(403");
  assert(signAt > 0 && adminAt > signAt);
  for (const a of ['"save"', '"publish"', '"discard"', '"retire"']) {
    assert(
      server.indexOf(`body.action === ${a}`) > adminAt,
      `${a} must come after the admin check`,
    );
  }
  assert(server.slice(signAt, adminAt).includes("inForce(rows).some((d) => d.id === doc.id)"));
  assert(server.slice(signAt, adminAt).includes("signatureProblem(typed, body.agreed === true)"));
});

Deno.test(
  "the staff page stops a rep who hasn't signed, and doesn't open when the check fails",
  () => {
    const gateAt = staff.indexOf("<RepDocumentsGate");
    const boardAt = staff.indexOf("<Board");
    assert(gateAt > 0 && boardAt > gateAt);
    assert(staff.includes('!access.isAdmin && repDocs.state !== "ok"'));
    assert(staff.includes("toSign(repDocs.docs, repDocs.signatures, access.isAdmin)"));
  },
);

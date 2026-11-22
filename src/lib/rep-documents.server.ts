// Server side of the rep agreements (GET and POST /api/rep-documents). Staff read what is in
// force and sign it; admins also write drafts, publish them and switch a document off. Every
// write goes through here with the service key, after checking who is asking; the tables take
// no write from the browser (supabase/migrations/20261119120000_rep_documents.sql).
// Never import this from browser code.
import { caller, json, service, SUPABASE_URL } from "@/lib/funder-send.server";
import { clientIp, readJson } from "@/lib/application-links.server";
import {
  DOC_COLUMNS,
  SIGNATURE_COLUMNS,
  draftProblem,
  freeKey,
  inForce,
  nextVersion,
  normaliseBody,
  signatureProblem,
  signedName,
  tableMissing,
  type RepDocument,
  type RepPerson,
  type RepSignature,
} from "@/lib/rep-documents";

type Svc = ReturnType<typeof service>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9][a-z0-9-]{1,40}$/;

async function who(
  request: Request,
): Promise<{ userId: string; email: string | null; isAdmin: boolean; svc: Svc } | Response> {
  if (!SUPABASE_URL()) return json(500, { error: "The server is missing its database settings." });
  const c = await caller(request);
  if (!c) return json(401, { error: "Sign in first." });
  const svc = service();
  const roles = await svc.from("user_roles").select("role").eq("user_id", c.userId);
  if (roles.error) return json(500, { error: "Couldn't check your access. Try again." });
  const held = new Set((roles.data as { role: string }[]).map((r) => r.role));
  if (!held.has("admin") && !held.has("rep"))
    return json(403, { error: "This is for the Lamp team." });
  const user = await svc.auth.admin.getUserById(c.userId);
  return {
    userId: c.userId,
    email: user.data.user?.email ?? null,
    isAdmin: held.has("admin"),
    svc,
  };
}

async function allDocs(svc: Svc) {
  return svc.from("rep_documents").select(DOC_COLUMNS).order("doc_key").order("version");
}

/**
 * GET: { ready, docs, signatures, people? }. A staff member gets the published documents and
 * their own signatures; an admin gets drafts, everyone's signatures and the team to check them
 * against. ready is false until the SQL has been run (then nobody is asked to sign anything).
 */
export async function listRepDocuments(request: Request): Promise<Response> {
  const w = await who(request);
  if (w instanceof Response) return w;
  const { svc, userId, isAdmin } = w;
  const docs = await allDocs(svc);
  if (tableMissing(docs.error)) return json(200, { ready: false, docs: [], signatures: [] });
  if (docs.error) return json(500, { error: "Couldn't load the agreements. Try again." });
  let sigQ = svc.from("rep_document_signatures").select(SIGNATURE_COLUMNS).order("signed_at");
  if (!isAdmin) sigQ = sigQ.eq("user_id", userId);
  const sigs = await sigQ;
  if (sigs.error) return json(500, { error: "Couldn't load the agreements. Try again." });
  const rows = (docs.data ?? []) as RepDocument[];
  if (!isAdmin) {
    return json(200, {
      ready: true,
      docs: rows.filter((d) => d.published_at),
      signatures: sigs.data ?? [],
    });
  }
  const [reps, admins] = await Promise.all([
    svc.from("reps").select("name,active,user_id").order("name"),
    svc.from("user_roles").select("user_id").eq("role", "admin"),
  ]);
  const adminIds = new Set(((admins.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const people: RepPerson[] = (
    (reps.data ?? []) as { name: string; active: boolean; user_id: string | null }[]
  ).map((r) => ({
    user_id: r.user_id,
    name: r.name,
    active: r.active,
    is_admin: !!r.user_id && adminIds.has(r.user_id),
  }));
  return json(200, { ready: true, docs: rows, signatures: sigs.data ?? [], people });
}

type Body = {
  action?: unknown;
  document_id?: unknown;
  doc_key?: unknown;
  title?: unknown;
  body?: unknown;
  typed_name?: unknown;
  agreed?: unknown;
  retired?: unknown;
  updated_at?: unknown;
};

/**
 * POST /api/rep-documents:
 *   { action: "sign", document_id, typed_name, agreed: true }   anyone on the team
 *   { action: "save", doc_key?, title, body }                    admins: write or update a draft
 *   { action: "publish", document_id, updated_at }               admins: put the draft they read in force
 *   { action: "discard", document_id }                           admins: throw a draft away
 *   { action: "retire", doc_key, retired: boolean }              admins: stop (or resume) asking
 */
export async function changeRepDocuments(request: Request): Promise<Response> {
  const w = await who(request);
  if (w instanceof Response) return w;
  const { svc, userId, isAdmin, email } = w;
  const body = await readJson<Body>(request, 200_000);
  if (body instanceof Response) return body;
  const docs = await allDocs(svc);
  if (tableMissing(docs.error))
    return json(409, {
      error: "Agreements aren't switched on yet: the database step hasn't been run.",
    });
  if (docs.error) return json(500, { error: "Couldn't load the agreements. Try again." });
  const rows = (docs.data ?? []) as RepDocument[];
  const docId =
    typeof body.document_id === "string" && UUID.test(body.document_id) ? body.document_id : null;
  const doc = docId ? rows.find((d) => d.id === docId) : undefined;

  if (body.action === "sign") {
    if (!doc) return json(404, { error: "That document isn't there anymore. Refresh the page." });
    if (!inForce(rows).some((d) => d.id === doc.id))
      return json(409, {
        error: "That version has been replaced. Refresh the page to read the new one.",
      });
    const typed = typeof body.typed_name === "string" ? body.typed_name : "";
    const problem = signatureProblem(typed, body.agreed === true);
    if (problem) return json(400, { error: problem });
    const ins = await svc
      .from("rep_document_signatures")
      .insert({
        document_id: doc.id,
        user_id: userId,
        signer_email: email,
        typed_name: signedName(typed),
        body_sha256: doc.body_sha256,
        ip: clientIp(request),
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, 400) || null,
      } as never)
      .select(SIGNATURE_COLUMNS)
      .maybeSingle();
    if (ins.error?.code === "23505") {
      const had = await svc
        .from("rep_document_signatures")
        .select(SIGNATURE_COLUMNS)
        .eq("document_id", doc.id)
        .eq("user_id", userId)
        .maybeSingle();
      return json(200, { signature: had.data });
    }
    if (ins.error) return json(500, { error: "Couldn't save your signature. Try again." });
    return json(200, { signature: ins.data as RepSignature });
  }

  if (!isAdmin) return json(403, { error: "Only admins change the agreements." });

  if (body.action === "save") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const text = typeof body.body === "string" ? normaliseBody(body.body) : "";
    const problem = draftProblem(title, text);
    if (problem) return json(400, { error: problem });
    const key =
      typeof body.doc_key === "string" && KEY.test(body.doc_key)
        ? body.doc_key
        : freeKey(
            title,
            rows.map((d) => d.doc_key),
          );
    const draft = rows.find((d) => d.doc_key === key && !d.published_at);
    const res = draft
      ? await svc
          .from("rep_documents")
          .update({ title, body: text } as never)
          .eq("id", draft.id)
          .is("published_at", null)
          .select(DOC_COLUMNS)
          .maybeSingle()
      : await svc
          .from("rep_documents")
          .insert({
            doc_key: key,
            version: nextVersion(rows, key),
            title,
            body: text,
            created_by: userId,
          } as never)
          .select(DOC_COLUMNS)
          .maybeSingle();
    if (res.error || !res.data) return json(500, { error: "Couldn't save the draft. Try again." });
    return json(200, { doc: res.data });
  }

  if (body.action === "publish") {
    if (!doc) return json(404, { error: "That draft isn't there anymore. Refresh the page." });
    if (doc.published_at) return json(409, { error: "That version is already published." });
    // publish exactly the draft the admin read: if it changed since, refuse
    const seen = typeof body.updated_at === "string" ? body.updated_at : "";
    if (!seen || Date.parse(seen) !== Date.parse(doc.updated_at))
      return json(409, {
        error: "Someone changed this draft since you opened it. Read it again, then publish.",
      });
    // the database computes the fingerprint from the stored text as it publishes
    const res = await svc
      .from("rep_documents")
      .update({
        published_at: new Date().toISOString(),
        published_by: userId,
        retired_at: null,
      } as never)
      .eq("id", doc.id)
      .is("published_at", null)
      .eq("updated_at", doc.updated_at)
      .select(DOC_COLUMNS)
      .maybeSingle();
    if (res.error || !res.data) return json(500, { error: "Couldn't publish it. Try again." });
    // publishing a new version switches the document back on if it had been stopped
    await svc
      .from("rep_documents")
      .update({ retired_at: null } as never)
      .eq("doc_key", doc.doc_key)
      .not("retired_at", "is", null);
    return json(200, { doc: res.data });
  }

  if (body.action === "discard") {
    if (!doc) return json(404, { error: "That draft isn't there anymore. Refresh the page." });
    if (doc.published_at)
      return json(409, { error: "A published version is kept for the record." });
    const res = await svc.from("rep_documents").delete().eq("id", doc.id).is("published_at", null);
    if (res.error) return json(500, { error: "Couldn't throw the draft away. Try again." });
    return json(200, { ok: true });
  }

  if (body.action === "retire") {
    const key = typeof body.doc_key === "string" && KEY.test(body.doc_key) ? body.doc_key : null;
    if (!key || !rows.some((d) => d.doc_key === key && d.published_at))
      return json(404, { error: "That document isn't published." });
    const res = await svc
      .from("rep_documents")
      .update({ retired_at: body.retired === true ? new Date().toISOString() : null } as never)
      .eq("doc_key", key)
      .not("published_at", "is", null);
    if (res.error) return json(500, { error: "Couldn't change it. Try again." });
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action." });
}

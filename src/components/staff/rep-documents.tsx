import { useCallback, useEffect, useState } from "react";
import { Download, FileSignature, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { chip, input, textarea } from "@/components/staff/field-styles";
import {
  copyFileName,
  draftProblem,
  inForce,
  signatureProblem,
  signedCopy,
  signingStatus,
  type RepDocument,
  type RepPerson,
  type RepSignature,
} from "@/lib/rep-documents";

/**
 * Rep agreements (Stevie, 2026-11-19): documents a rep signs before using the staff page.
 *   - RepDocumentsGate: the page a non-admin sees until they've signed everything in force;
 *   - RepDocumentsAdmin: on Team, write a document, publish it, see who has signed;
 *   - MySignedDocuments: on Training, what this person signed, with a copy to keep.
 * Everything goes through /api/rep-documents; the browser writes nothing to the tables.
 */

type Loaded = {
  ready: boolean;
  docs: RepDocument[];
  signatures: RepSignature[];
  people?: RepPerson[];
};

async function call<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const res = await fetch("/api/rep-documents", {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

export type RepDocsState =
  { state: "loading" } | { state: "error"; message: string } | ({ state: "ok" } & Loaded);

/** The agreements as this person sees them; reload() after a change. */
export function useRepDocuments(enabled: boolean) {
  const [s, setS] = useState<RepDocsState>({ state: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    call<Loaded>("GET")
      .then((d) => live && setS({ state: "ok", ...d }))
      .catch(
        (e: unknown) =>
          live &&
          setS({
            state: "error",
            message: e instanceof Error ? e.message : "Couldn't load the agreements.",
          }),
      );
    return () => {
      live = false;
    };
  }, [enabled, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { docs: s, reload };
}

function saveCopy(doc: RepDocument, sig?: RepSignature | null) {
  const url = URL.createObjectURL(new Blob([signedCopy(doc, sig)], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = copyFileName(doc);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The document's text, as the signer reads it. */
function DocText({ doc, tall = false }: { doc: RepDocument; tall?: boolean }) {
  return (
    <div
      className={cn(
        "overflow-y-auto whitespace-pre-wrap rounded-xl bg-white px-4 py-4 text-[0.95rem] leading-relaxed ring-1 ring-line sm:px-6",
        tall ? "max-h-[55vh]" : "max-h-80",
      )}
      tabIndex={0}
      aria-label={`${doc.title}, version ${doc.version}`}
      data-rep-doc-text
    >
      {doc.body}
    </div>
  );
}

/**
 * What a rep sees before the staff page: each document in force they haven't signed, one at a
 * time. Signing is a ticked box and their typed full name; the server records the time, the
 * address it came from and a fingerprint of the exact text.
 */
export function RepDocumentsGate({
  pending,
  email,
  onSigned,
}: {
  pending: RepDocument[];
  email: string | null;
  onSigned: () => void;
}) {
  const doc = pending[0]!;
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // a new document starts clean
  useEffect(() => {
    setAgreed(false);
    setName("");
    setError("");
    setBusy(false);
  }, [doc.id]);

  async function sign() {
    const problem = signatureProblem(name, agreed);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call("POST", { action: "sign", document_id: doc.id, typed_name: name, agreed });
      // stays busy until the next document (or the staff page) replaces this one
      onSigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your signature.");
      setBusy(false);
    }
  }

  async function signOut() {
    await getSupabase()?.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <div
      className="mx-auto w-full max-w-3xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14"
      data-rep-gate={doc.doc_key}
    >
      <p className="text-sm text-smoke">
        {email} · Before you start
        {pending.length > 1 && ` · 1 of ${pending.length} to sign`}
      </p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {doc.title}
      </h1>
      <p className="mt-2 text-sm text-smoke">
        Version {doc.version}
        {doc.published_at && `, published ${stamp(doc.published_at)}`}. Read it, then sign at the
        bottom to open the staff page.
      </p>
      <div className="mt-6">
        <DocText doc={doc} tall />
      </div>
      <button
        type="button"
        className={cn(chip, "mt-3 max-md:min-h-11")}
        onClick={() => saveCopy(doc)}
      >
        <Download className="size-3.5" /> Save a copy
      </button>

      <form
        className={cn(card, "mt-6 grid gap-4 p-5 sm:p-6")}
        onSubmit={(e) => {
          e.preventDefault();
          void sign();
        }}
      >
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            data-rep-agree
          />
          <span>
            I have read the {doc.title} (version {doc.version}) and I agree to it. Typing my name
            below is my electronic signature.
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          Your full name
          <input
            className={input}
            value={name}
            autoComplete="name"
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="First and last name"
            data-rep-name
          />
        </label>
        {error && (
          <p className="text-sm font-semibold text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className={cn(btnPrimary, "max-md:w-full")}
            disabled={busy}
            data-rep-sign
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileSignature className="size-4" />
            )}
            Sign and continue
          </button>
          <button
            type="button"
            className="min-h-11 px-2 text-sm text-smoke underline"
            onClick={() => void signOut()}
          >
            Not now, sign me out
          </button>
        </div>
        <p className="text-xs text-smoke">
          Questions about this document? Ask Stevie before you sign. You can find what you signed
          later under Training.
        </p>
      </form>
    </div>
  );
}

/** Training: the documents this person signed, with a copy of each to keep. */
export function MySignedDocuments() {
  const { docs } = useRepDocuments(true);
  if (docs.state !== "ok" || !docs.ready) return null;
  const mine = docs.signatures
    .map((s) => ({ s, d: docs.docs.find((d) => d.id === s.document_id) }))
    .filter((x): x is { s: RepSignature; d: RepDocument } => !!x.d);
  if (!mine.length) return null;
  return (
    <section className="mt-8" data-my-signed>
      <h2 className="font-display text-xl font-semibold">Your signed agreements</h2>
      <ul className="mt-3 grid gap-2">
        {mine.map(({ s, d }) => (
          <li
            key={s.id}
            className={cn(card, "flex flex-wrap items-center justify-between gap-3 px-4 py-3")}
          >
            <span className="text-sm">
              <span className="font-semibold">{d.title}</span> · version {d.version} · signed{" "}
              {stamp(s.signed_at)} as {s.typed_name}
            </span>
            <button
              type="button"
              className={cn(chip, "max-md:min-h-11")}
              onClick={() => saveCopy(d, s)}
            >
              <Download className="size-3.5" /> Save a copy
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Editing = { doc_key: string | null; title: string; body: string };

/**
 * Team (admins): the agreements reps sign. Write or paste a document, save it as a draft, read
 * it, publish it. Publishing asks every active rep who isn't an admin to sign it the next time
 * they open the staff page; a published version can't be changed, only replaced by a new one.
 */
export function RepDocumentsAdmin() {
  const { docs, reload } = useRepDocuments(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<RepDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await call("POST", body);
      setNote(done);
      setEditing(null);
      setConfirm(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (docs.state === "loading")
    return (
      <section className="mt-10" data-rep-docs-admin>
        <Loader2 className="size-5 animate-spin text-smoke" />
      </section>
    );

  const head = (
    <>
      <h2 className="font-display text-xl font-semibold">Rep agreements</h2>
      <p className="mt-1 max-w-2xl text-sm text-smoke">
        What every rep who isn&apos;t an admin signs before they can use the staff page: they read
        it, tick a box and type their full name. A new version asks them again. Admins don&apos;t
        sign.
      </p>
    </>
  );

  if (docs.state === "error")
    return (
      <section className="mt-10" data-rep-docs-admin>
        {head}
        <p className="mt-3 text-sm text-destructive">{docs.message}</p>
      </section>
    );
  if (!docs.ready)
    return (
      <section className="mt-10" data-rep-docs-admin>
        {head}
        <p className="mt-3 text-sm text-smoke">
          Not switched on yet: the database step for agreements hasn&apos;t been run.
        </p>
      </section>
    );

  const keys = [...new Set(docs.docs.map((d) => d.doc_key))];
  const live = inForce(docs.docs);
  const people = docs.people ?? [];

  return (
    <section className="mt-10" data-rep-docs-admin>
      {head}
      {note && <p className="mt-3 text-sm font-semibold text-forest">{note}</p>}
      {error && (
        <p className="mt-3 text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}

      <ul className="mt-4 grid gap-4">
        {keys.map((key) => {
          const versions = docs.docs.filter((d) => d.doc_key === key);
          const published = versions.filter((d) => d.published_at);
          const current = published.at(-1) ?? null;
          const draft = versions.find((d) => !d.published_at) ?? null;
          const on = !!current && live.some((d) => d.id === current.id);
          const status = current ? signingStatus(current, people, docs.signatures) : [];
          const signedCount = status.filter((r) => r.signed).length;
          return (
            <li key={key} className={cn(card, "p-5")} data-rep-doc={key}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold">
                    {(current ?? draft)?.title}
                  </h3>
                  <p className="mt-0.5 text-sm text-smoke">
                    {current
                      ? `Version ${current.version}, published ${stamp(current.published_at)}. `
                      : "Not published yet. "}
                    {current &&
                      (on
                        ? `${signedCount} of ${status.length} reps signed.`
                        : "Switched off: nobody is asked to sign it.")}
                    {draft && ` A draft of version ${draft.version} is waiting.`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {draft && (
                    <button
                      type="button"
                      className={cn(chip, "max-md:min-h-11")}
                      disabled={busy}
                      onClick={() => setConfirm(draft)}
                      data-rep-publish
                    >
                      Publish version {draft.version}
                    </button>
                  )}
                  <button
                    type="button"
                    className={cn(chip, "max-md:min-h-11")}
                    disabled={busy}
                    onClick={() =>
                      setEditing({
                        doc_key: key,
                        title: (draft ?? current)?.title ?? "",
                        body: (draft ?? current)?.body ?? "",
                      })
                    }
                  >
                    {draft ? "Edit the draft" : "Write a new version"}
                  </button>
                  {draft && (
                    <button
                      type="button"
                      className={cn(chip, "max-md:min-h-11")}
                      disabled={busy}
                      onClick={() =>
                        void act({ action: "discard", document_id: draft.id }, "Draft thrown away.")
                      }
                    >
                      Throw the draft away
                    </button>
                  )}
                  {current && (
                    <button
                      type="button"
                      className={cn(chip, "max-md:min-h-11")}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          { action: "retire", doc_key: key, retired: on },
                          on
                            ? "Stopped asking for it. Earlier signatures are kept."
                            : "Asking for it again.",
                        )
                      }
                    >
                      {on ? "Stop asking" : "Ask again"}
                    </button>
                  )}
                </div>
              </div>

              {confirm && confirm.doc_key === key && (
                <div className="mt-4 rounded-xl bg-sand/60 p-4 ring-1 ring-line" data-rep-confirm>
                  <p className="text-sm font-semibold">
                    Publish {confirm.title}, version {confirm.version}?
                  </p>
                  <p className="mt-1 text-sm text-smoke">
                    Every active rep who isn&apos;t an admin will have to sign it the next time they
                    open the staff page. Once published, this text can&apos;t be changed: fixing it
                    means publishing a new version, which everyone signs again. Read it first:
                  </p>
                  <div className="mt-3">
                    <DocText doc={confirm} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={cn(btnPrimary, "py-2.5")}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          {
                            action: "publish",
                            document_id: confirm.id,
                            updated_at: confirm.updated_at,
                          },
                          `Published version ${confirm.version}.`,
                        )
                      }
                      data-rep-publish-confirm
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />} Publish it
                    </button>
                    <button
                      type="button"
                      className={cn(btnOutline, "py-2.5")}
                      onClick={() => setConfirm(null)}
                    >
                      Not yet
                    </button>
                  </div>
                </div>
              )}

              {current && on && status.length > 0 && (
                <ul className="mt-4 grid gap-1 text-sm" data-rep-doc-status>
                  {status.map((r) => (
                    <li
                      key={r.name}
                      className="flex flex-wrap justify-between gap-x-4 border-t border-line py-1.5"
                    >
                      <span>{r.name}</span>
                      <span className={r.signed ? "text-forest" : "text-smoke"}>
                        {r.signed
                          ? `Signed ${stamp(r.signed.signed_at)} as ${r.signed.typed_name}`
                          : r.waiting
                            ? "Hasn't signed in yet"
                            : "Not signed yet"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {current && (
                <button
                  type="button"
                  className="mt-3 text-sm text-smoke underline"
                  onClick={() => saveCopy(current)}
                >
                  Save a copy of version {current.version}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {editing ? (
        <DocEditor
          key={editing.doc_key ?? "new"}
          editing={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(e) =>
            void act(
              { action: "save", doc_key: e.doc_key, title: e.title, body: e.body },
              "Draft saved. Read it, then publish it when it's right.",
            )
          }
        />
      ) : (
        <button
          type="button"
          className={cn(btnOutline, "mt-4 py-2.5")}
          onClick={() => setEditing({ doc_key: null, title: "", body: "" })}
          data-rep-new-doc
        >
          <FileSignature className="size-4" />{" "}
          {keys.length ? "Add another document" : "Add the rep agreement"}
        </button>
      )}
    </section>
  );
}

function DocEditor({
  editing,
  busy,
  onCancel,
  onSave,
}: {
  editing: Editing;
  busy: boolean;
  onCancel: () => void;
  onSave: (e: Editing) => void;
}) {
  const [title, setTitle] = useState(editing.title);
  const [body, setBody] = useState(editing.body);
  const [error, setError] = useState("");
  return (
    <form
      className={cn(card, "mt-4 grid gap-3 p-5")}
      onSubmit={(e) => {
        e.preventDefault();
        const problem = draftProblem(title, body);
        if (problem) {
          setError(problem);
          return;
        }
        onSave({ doc_key: editing.doc_key, title, body });
      }}
      data-rep-doc-editor
    >
      <label className="grid gap-1.5 text-sm font-semibold">
        Title
        <input
          className={input}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Independent Sales Representative Agreement"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        The full text
        <textarea
          className={cn(textarea, "min-h-72 font-normal leading-relaxed")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Paste the agreement exactly as reps should read it. Blank lines separate paragraphs."
        />
      </label>
      {error && (
        <p className="text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-smoke">
        Saving keeps it as a draft: no rep sees it until you publish it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={cn(btnPrimary, "py-2.5")} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save draft
        </button>
        <button type="button" className={cn(btnOutline, "py-2.5")} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

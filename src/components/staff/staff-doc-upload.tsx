import { useRef, useState, type DragEvent } from "react";
import { Check, Loader2, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { postAsMe } from "@/lib/server-api";
import {
  DOCUMENT_KINDS,
  DOCUMENT_LABELS,
  staffUploadProblem,
  type DocumentKind,
} from "@/lib/documents";

/**
 * On a file: drop documents in (or click to choose) when they came in some other way, an
 * emailed statement, a photo of a voided check. Each file goes to /api/documents/staff-upload,
 * which checks the person may work the file and stores it; the merchant sees it on their account
 * page and the timeline says the team added it.
 */

type Result = { name: string; ok: boolean; note: string };

export function StaffDocUpload({ fileId, onDone }: { fileId: string; onDone: () => void }) {
  const [kind, setKind] = useState<DocumentKind>("bank_statement");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const input = useRef<HTMLInputElement>(null);

  async function send(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length || busy) return;
    const out: Result[] = [];
    for (const f of files) {
      const problem = staffUploadProblem(f);
      if (problem) {
        out.push({ name: f.name, ok: false, note: problem });
        continue;
      }
      setBusy(f.name);
      const form = new FormData();
      form.set("application_id", fileId);
      form.set("kind", kind);
      form.set("file", f);
      const r = await postAsMe<{ outcome: string }>("/api/documents/staff-upload", form).catch(
        () => null,
      );
      out.push(
        r?.ok && r.data.outcome === "saved"
          ? { name: f.name, ok: true, note: `Added as ${DOCUMENT_LABELS[kind].toLowerCase()}` }
          : {
              name: f.name,
              ok: false,
              note: r?.data.error ?? "Couldn't reach the server. Try again.",
            },
      );
    }
    setBusy(null);
    setResults(out);
    if (input.current) input.current.value = "";
    if (out.some((x) => x.ok)) onDone();
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void send(e.dataTransfer.files);
  };

  return (
    <div className="mt-4" data-staff-upload>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label
          htmlFor={`kind-${fileId}`}
          className="text-xs font-semibold uppercase tracking-wide text-smoke"
        >
          Add as
        </label>
        <select
          id={`kind-${fileId}`}
          className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-line max-md:min-h-11 max-md:text-base"
          value={kind}
          disabled={!!busy}
          onChange={(e) => setKind(e.target.value as DocumentKind)}
          data-staff-upload-kind
        >
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={!!busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          "mt-2 flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition",
          over ? "border-forest bg-leaf/10" : "border-line hover:border-ink/30",
        )}
        data-staff-upload-zone
      >
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin text-smoke" />
            <span>Adding {busy}…</span>
          </>
        ) : (
          <>
            <UploadCloud className="size-5 text-smoke" />
            <span className="font-semibold">Drop files here, or click to choose</span>
            <span className="text-xs text-smoke">
              PDF or photo (JPG, PNG or HEIC), up to 20 MB each. Several at once is fine.
            </span>
          </>
        )}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="application/pdf,image/jpeg,image/png,image/heic,.pdf,.heic"
        onChange={(e) => void send(e.target.files)}
      />
      {results.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" data-staff-upload-results>
          {results.map((r, i) => (
            <li
              key={i}
              className={cn("flex items-start gap-1.5", r.ok ? "text-forest" : "text-destructive")}
            >
              {r.ok ? (
                <Check className="mt-0.5 size-4 shrink-0" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                <span className="font-semibold">{r.name}</span>: {r.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

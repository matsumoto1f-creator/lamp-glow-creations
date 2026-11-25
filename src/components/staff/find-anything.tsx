import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Search, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, isStage } from "@/lib/staff";
import { ENGINE_STATUS_LABEL, type EngineStatus } from "@/lib/engine-leads";
import {
  detailOf,
  FIND_COLUMNS,
  KIND_LABEL,
  KIND_ORDER,
  orFilter,
  recordSearch,
  titleOf,
  type FindKind,
  type FindResult,
} from "@/lib/find";

const PER_KIND = 8;
type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : null);

function linkStatus(r: Row): string {
  if (r["submitted_at"]) return "Signed";
  if (r["cancelled_at"]) return "Stopped";
  if (r["started_at"]) return "Started";
  if (r["opened_at"]) return "Opened";
  return "Sent";
}

/** One kind of record, searched as the signed-in person (row rules decide what they see). */
async function look(kind: FindKind, term: string): Promise<FindResult[] | "failed"> {
  const sb = getSupabase();
  const cols = FIND_COLUMNS[kind];
  const match = orFilter(term, cols.text, cols.phone);
  if (!sb || !match) return [];
  if (kind === "file") {
    const r = await sb
      .from("applications")
      .select("id,business_name,first_name,phone,email,status")
      .or(match)
      .order("updated_at", { ascending: false })
      .limit(PER_KIND);
    if (r.error) return "failed";
    return (r.data as Row[]).map((x) => ({
      kind,
      key: `file:${String(x["id"])}`,
      title: titleOf(s(x["business_name"]), s(x["first_name"])),
      label: `${KIND_LABEL.file} · ${isStage(x["status"]) ? STAGE_LABEL[x["status"]] : "File"}`,
      detail: detailOf(s(x["phone"]), s(x["email"])),
      open: recordSearch({ file: String(x["id"]) })!,
    }));
  }
  if (kind === "engine") {
    const r = await sb
      .from("engine_leads")
      .select("id,name,phone,email,status,contact_name,contact_phone,contact_email")
      .or(match)
      .order("worked_at", { ascending: false, nullsFirst: false })
      .limit(PER_KIND);
    if (r.error) return "failed";
    return (r.data as Row[]).map((x) => ({
      kind,
      key: `engine:${String(x["id"])}`,
      title: titleOf(s(x["name"]), s(x["contact_name"])),
      label: `${KIND_LABEL.engine} · ${ENGINE_STATUS_LABEL[x["status"] as EngineStatus] ?? "Lead"}`,
      detail: detailOf(
        s(x["contact_phone"]) || s(x["phone"]),
        s(x["contact_email"]) || s(x["email"]),
      ),
      open: recordSearch({ elead: Number(x["id"]) })!,
    }));
  }
  if (kind === "link") {
    const r = await sb
      .from("application_invites")
      .select(
        "id,business_name,first_name,last_name,phone,email,application_id,file_id,engine_lead_id,submitted_at,started_at,opened_at,cancelled_at",
      )
      .or(match)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(PER_KIND);
    if (r.error) return "failed";
    return (r.data as Row[]).map((x) => ({
      kind,
      key: `link:${String(x["id"])}`,
      title: titleOf(
        s(x["business_name"]),
        `${s(x["first_name"]) ?? ""} ${s(x["last_name"]) ?? ""}`,
      ),
      label: `${KIND_LABEL.link} · ${linkStatus(x)}`,
      detail: detailOf(s(x["phone"]), s(x["email"])),
      open: recordSearch({
        file: s(x["application_id"]) || s(x["file_id"]),
        elead: typeof x["engine_lead_id"] === "number" ? x["engine_lead_id"] : null,
        invite: String(x["id"]),
      })!,
    }));
  }
  const r = await sb
    .from("leads")
    .select("id,first_name,phone,email,converted_application_id")
    .or(match)
    .order("created_at", { ascending: false })
    .limit(PER_KIND);
  if (r.error) return "failed";
  return (r.data as Row[]).map((x) => ({
    kind,
    key: `website:${String(x["id"])}`,
    title: titleOf(s(x["first_name"]), s(x["email"])),
    label: KIND_LABEL.website,
    detail: detailOf(s(x["phone"]), s(x["email"])),
    open: recordSearch({ file: s(x["converted_application_id"]), lead: String(x["id"]) })!,
  }));
}

/**
 * The search box at the top of every staff page. It looks through files, engine leads,
 * application links and website leads at once, by business or person name, email or phone
 * however it is typed, and each result opens that record's own page.
 */
export function FindAnything() {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<FindResult[] | null>(null);
  const [failed, setFailed] = useState<FindKind[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      setFailed([]);
      return undefined;
    }
    let live = true;
    setResults(null);
    void Promise.all(KIND_ORDER.map((k) => look(k, term).catch(() => "failed" as const))).then(
      (all) => {
        if (!live) return;
        setFailed(KIND_ORDER.filter((_, i) => all[i] === "failed"));
        setResults(all.flatMap((a) => (a === "failed" ? [] : a)));
      },
    );
    return () => {
      live = false;
    };
  }, [term]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const showing = open && term.length >= 2;
  return (
    <div ref={box} className="relative w-full max-w-xl" data-find>
      <label className="relative block">
        <span className="sr-only">Find a business, person, phone or email</span>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-smoke"
          aria-hidden
        />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="Find a business, person, phone or email"
          className="min-h-11 w-full rounded-full bg-white py-2 pl-10 pr-10 text-base text-ink ring-1 ring-line placeholder:text-smoke md:text-sm"
          autoComplete="off"
          data-find-input
        />
        {text && (
          <button
            type="button"
            className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-smoke hover:text-ink"
            aria-label="Clear the search"
            onClick={() => {
              setText("");
              setTerm("");
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </label>
      {showing && (
        <div
          className="absolute left-0 right-0 top-12 z-40 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-white p-2 text-sm text-ink shadow-xl"
          role="region"
          aria-label="Search results"
          aria-live="polite"
          data-find-results
        >
          {results === null ? (
            <p className="flex items-center gap-2 px-3 py-3 text-smoke">
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> Searching
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-smoke" data-find-empty>
              Nothing you can see matches &quot;{term}&quot; in files, engine leads, application
              links or website leads.
            </p>
          ) : (
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.key}>
                  <Link
                    to="/staff"
                    search={r.open as never}
                    className="block rounded-xl px-3 py-2 hover:bg-sand focus-visible:outline-2 focus-visible:outline-forest"
                    onClick={() => setOpen(false)}
                    data-find-result={r.kind}
                  >
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="block truncate text-xs text-smoke">
                      {r.label}
                      {r.detail && ` · ${r.detail}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {failed.length > 0 && (
            <p className="px-3 pb-2 pt-1 text-xs text-smoke" data-find-failed>
              Couldn&apos;t search {failed.map((k) => KIND_LABEL[k].toLowerCase()).join(", ")} just
              now.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

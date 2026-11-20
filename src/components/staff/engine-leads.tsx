import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Copy,
  Download,
  FilePen,
  Loader2,
  Phone,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { chip, input, textarea } from "@/components/staff/field-styles";
import { smartLead } from "@/lib/smart-lead";
import { LEAD_WORKED_EVENT } from "@/lib/focus";
import { SpeakButton } from "@/components/staff/speak-button";
import { fitTo, joinSpoken, paperLink } from "@/lib/spoken-notes";
import { SendApplications, type SendSeed } from "@/components/staff/send-applications";
import { postInvites } from "@/lib/post-invites";
import {
  EMAIL_KIND_LABEL,
  EMAIL_KINDS,
  EMAIL_RE,
  MAX_RECIPIENTS,
  type EmailKind,
} from "@/lib/application-links";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TablesInsert } from "@/integrations/supabase/types";
import {
  BOARD_ORIGINS,
  ENGINE_STATUS_LABEL,
  ENGINE_STATUSES,
  LEAD_APPROACH,
  LEAD_TYPE_LABEL,
  LEAD_TYPES,
  TIERS,
  boardBatch,
  leadCardText,
  leadRecords,
  leadType,
  leadsFromCsv,
  leadsToCsv,
  searchFilter,
  ownerLabel,
  ownerScope,
  savedOwner,
  type LeadOwner,
  signalSummary,
  splitWhy,
  tel,
  tookMca,
  type EngineStatus,
  type LeadType,
} from "@/lib/engine-leads";

/**
 * Engine leads: businesses the public-record lead engine found and tiered (A is the dial
 * list). The engine runs outside Lamp; an admin picks leads there, downloads them with the rep
 * each one goes to, and uploads the file here. A rep sees and works only their own leads and
 * records what happened on the call; the engine never dials or sends, a person does.
 * Clicking a lead opens its page: the contact the rep gets on the call (who, the email for the
 * application, the best number) and notes, saved to columns no push touches; then who to ask for,
 * why it was picked, every public record behind it and how to open the call.
 * Ticking leads opens Send the application: one personal link each, by email or to copy.
 * Search looks through name, phone, email, city and industry within the tier and status
 * picked; admins can also download the ticked leads as a CSV.
 */

type Row = {
  id: number;
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
  status: string;
  notes: string;
  rep_slug: string | null;
  first_found: string | null;
  pushed_at: string;
  worked_at: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_updated_at: string | null;
};

type ContactPatch = Pick<Row, "contact_name" | "contact_email" | "contact_phone" | "notes">;

/** The list's filter boxes: as before on a computer; full width, 44px and 16px type on a phone. */
const filterSelect =
  "rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line max-md:min-h-11 max-md:w-full max-md:text-base";

const COLUMNS =
  "id,name,phone,email,city,state,industry,tier,need,reason,signals,status,notes,rep_slug,first_found,pushed_at,worked_at,contact_name,contact_email,contact_phone,contact_updated_at";
const LIMIT = 300;
/** This browser remembers whose leads an admin last picked. */
const OWNER_KEY = "lamp.engine-leads.owner";

export function EngineLeads({
  isAdmin,
  repSlug,
  reps,
}: {
  isAdmin: boolean;
  repSlug: string | null;
  reps: { slug: string; name: string }[];
}) {
  const [tier, setTier] = useState<string>(isAdmin ? "A" : "");
  const [status, setStatus] = useState<string>("new");
  // admins only: whose leads (reps see only their own, the database decides)
  const [owner, setOwnerState] = useState<LeadOwner>("");
  const [ownerReady, setOwnerReady] = useState(!isAdmin);
  useEffect(() => {
    if (!isAdmin) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(OWNER_KEY);
    } catch {
      /* storage off: start on everyone */
    }
    // until the team list has loaded, a remembered rep is trusted as is; once it has, a rep
    // who's no longer on it falls back to everyone
    setOwnerState(
      !reps.length && saved?.startsWith("rep:") && ownerScope(saved, repSlug).kind === "rep"
        ? (saved as LeadOwner)
        : savedOwner(saved, repSlug, reps),
    );
    setOwnerReady(true);
  }, [isAdmin, repSlug, reps]);
  function setOwner(next: LeadOwner) {
    setOwnerState(next);
    setOwnerReady(true);
    try {
      window.localStorage.setItem(OWNER_KEY, next);
    } catch {
      /* not remembered: fine */
    }
  }
  // "" shows every type in one list; a type narrows the loaded list without a reload
  const [kind, setKind] = useState<LeadType | "">("");
  const [search, setSearch] = useState("");
  // what the list was last loaded for: the box waits for a pause in typing
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // the lead whose page is open
  const [openId, setOpenId] = useState<number | null>(null);
  // The send panel, keyed so picking again starts it fresh with the new picks.
  // leadId: opened from that lead's own page, so the panel shows there, next to the lead
  const [sending, setSending] = useState<{
    key: number;
    seed: SendSeed[];
    kind?: EmailKind;
    leadId?: number;
  } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !ownerReady) return;
    let live = true;
    setRows(null);
    setError("");
    setSelected(new Set());
    (async () => {
      let q = sb.from("engine_leads").select(COLUMNS).not("phone", "is", null).neq("phone", "");
      if (tier) q = q.eq("tier", tier);
      if (status) q = q.eq("status", status);
      if (isAdmin) {
        const who = ownerScope(owner, repSlug);
        if (who.kind === "rep") q = q.eq("rep_slug", who.slug);
        if (who.kind === "none") q = q.is("rep_slug", null);
      }
      const match = searchFilter(query);
      if (match) q = q.or(match);
      const { data, error: err } = await q
        .order("need", { ascending: false, nullsFirst: false })
        .order("first_found", { ascending: false })
        .order("id")
        .limit(LIMIT);
      if (!live) return;
      if (err) {
        setError("Couldn't load the engine leads. Refresh to try again.");
        setRows([]);
        return;
      }
      setRows(data as Row[]);
    })();
    return () => {
      live = false;
    };
  }, [tier, status, query, reload, owner, ownerReady, isAdmin, repSlug]);

  async function setLeadStatus(row: Row, next: EngineStatus) {
    const sb = getSupabase();
    if (!sb || next === row.status) return;
    setSaving(row.id);
    const { error: err } = await sb.from("engine_leads").update({ status: next }).eq("id", row.id);
    setSaving(null);
    if (err) {
      setError(`Couldn't save ${row.name ?? "that lead"}: ${err.message}`);
      return;
    }
    if (next === "do_not_call") pick(row.id, false);
    window.dispatchEvent(new Event(LEAD_WORKED_EVENT));
    setRows((rs) =>
      rs
        ? rs.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  status: next,
                  worked_at: new Date().toISOString(),
                  rep_slug: r.rep_slug ?? repSlug,
                }
              : r,
          )
        : rs,
    );
  }

  async function assignRep(row: Row, next: string) {
    const sb = getSupabase();
    const slug = next || null;
    if (!sb || slug === row.rep_slug) return;
    setSaving(row.id);
    const { error: err } = await sb
      .from("engine_leads")
      .update({ rep_slug: slug })
      .eq("id", row.id);
    setSaving(null);
    if (err) {
      setError(`Couldn't reassign ${row.name ?? "that lead"}: ${err.message}`);
      return;
    }
    setRows((rs) => (rs ? rs.map((r) => (r.id === row.id ? { ...r, rep_slug: slug } : r)) : rs));
  }

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : null;

  // Do-not-call leads never get a link (the server refuses them too).
  const canPick = (r: Row) => r.status !== "do_not_call";
  const shown = rows && kind ? rows.filter((r) => leadType(r.signals) === kind) : rows;
  const pickable = (shown ?? []).filter(canPick);
  const allPicked = pickable.length > 0 && pickable.every((r) => selected.has(r.id));
  const somePicked = pickable.some((r) => selected.has(r.id));

  const openRow = openId == null ? null : ((rows ?? []).find((r) => r.id === openId) ?? null);

  /** Saves what the rep got on the call; returns an error to show, or "" when it saved. */
  async function saveContact(row: Row, patch: ContactPatch): Promise<string> {
    const sb = getSupabase();
    if (!sb) return "Not connected. Refresh and try again.";
    const { data, error: err } = await sb
      .from("engine_leads")
      .update(patch)
      .eq("id", row.id)
      .select("contact_updated_at")
      .maybeSingle();
    if (err) return `Couldn't save: ${err.message}`;
    if (!data) return "Couldn't save: this lead isn't yours to change.";
    window.dispatchEvent(new Event(LEAD_WORKED_EVENT));
    setRows((rs) =>
      rs
        ? rs.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  ...patch,
                  contact_updated_at: data.contact_updated_at ?? r.contact_updated_at,
                }
              : r,
          )
        : rs,
    );
    return "";
  }

  function pick(id: number, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function pickPage(on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      for (const r of pickable) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  /** Ticked leads from the list; or one lead from its own page, with the email picked there. */
  function openSend(only?: Row, kind?: EmailKind) {
    const seed = (only ? [only] : (rows ?? []).filter((r) => selected.has(r.id)))
      .filter(canPick)
      .map((r) => sendSeed(r));
    if (seed.length)
      setSending((s) => ({
        key: (s?.key ?? 0) + 1,
        seed,
        ...(kind ? { kind } : {}),
        ...(only ? { leadId: only.id } : {}),
      }));
  }

  /** Admins only: the ticked leads as a CSV file. */
  function downloadCsv() {
    const picked = (rows ?? []).filter((r) => selected.has(r.id));
    if (!picked.length) return;
    const url = URL.createObjectURL(
      new Blob([leadsToCsv(picked, (slug) => repName(slug) ?? "")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `lamp-leads-${new Date().toISOString().slice(0, 10)}-${picked.length}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mt-8">
      <div className="grid grid-cols-2 items-end gap-3 md:flex md:flex-wrap">
        <label className="text-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Tier
          </span>
          <select className={filterSelect} value={tier} onChange={(e) => setTier(e.target.value)}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t === "A" ? "A — dial first" : t}
              </option>
            ))}
            <option value="">All tiers</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Status
          </span>
          <select
            className={filterSelect}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {ENGINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ENGINE_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="">Any status</option>
          </select>
        </label>
        {isAdmin && (
          <label className="col-span-2 text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
              Whose leads
            </span>
            <select
              className={filterSelect}
              value={owner}
              onChange={(e) => setOwner(e.target.value as LeadOwner)}
              data-lead-owner
            >
              <option value="">Everyone&apos;s</option>
              {repSlug && <option value="me">Mine</option>}
              <option value="none">Not given to anyone</option>
              {reps
                .filter((r) => r.slug !== repSlug)
                .map((r) => (
                  <option key={r.slug} value={`rep:${r.slug}`}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="col-span-2 text-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Type
          </span>
          <select
            className={filterSelect}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as LeadType | "");
              setSelected(new Set());
            }}
            data-lead-type
          >
            <option value="">All types, one list</option>
            {LEAD_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAD_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 min-w-[14rem] flex-1 text-sm sm:max-w-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Search
          </span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-smoke" />
            <input
              type="search"
              className="w-full rounded-full bg-white py-2 pl-10 pr-4 text-sm ring-1 ring-line max-md:min-h-11 max-md:text-base"
              placeholder="Business, phone, email, city, industry"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-lead-search
            />
          </span>
        </label>
        <button
          type="button"
          className="rounded-full px-4 py-2 text-sm font-semibold text-smoke ring-1 ring-line hover:text-ink max-md:min-h-11 max-md:justify-self-start"
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh
        </button>
        <p className="ml-auto text-sm text-smoke max-md:self-center max-md:justify-self-end">
          {isAdmin ? ownerLabel(owner, repSlug, reps) : "Your leads"}
          {rows && ` · ${rows.length}${rows.length === LIMIT ? "+" : ""}`}
          {rows && kind && ` · ${shown?.length ?? 0} ${LEAD_TYPE_LABEL[kind].toLowerCase()}`}
        </p>
      </div>

      <p className="mt-3 text-xs text-smoke">
        Found by the lead engine from public records and tiered by need.{" "}
        {isAdmin
          ? "Each rep sees only the leads assigned to them."
          : "These are assigned to you; no other rep sees them."}{" "}
        Set the status after every call; it stamps the time. Nothing here dials or sends.
      </p>

      {isAdmin && <UploadLeads reps={reps} onDone={() => setReload((n) => n + 1)} />}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {sending && sending.leadId == null && (
        <SendApplications
          key={sending.key}
          isAdmin={isAdmin}
          repSlug={repSlug}
          reps={reps}
          seed={sending.seed}
          onClose={() => setSending(null)}
          // reload: the server keeps a typed-in email on the lead for next time
          onSent={() => setReload((n) => n + 1)}
        />
      )}

      <div className={cn(card, "mt-4 overflow-x-auto")}>
        {rows === null || shown === null ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : rows.length > 0 && shown.length === 0 && kind ? (
          <p className="px-6 py-12 text-center text-sm text-smoke">
            No {LEAD_TYPE_LABEL[kind].toLowerCase()} leads in this list. Pick All types to see the
            rest.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-smoke">
            {query
              ? `Nothing matches "${query}"${tier || status ? " in this tier and status. Try All tiers and Any status." : "."}`
              : isAdmin
                ? "No engine leads here. Send leads from the Board, or upload its file, to hand some out."
                : "No leads assigned to you here yet."}
          </p>
        ) : (
          <>
            {/* On a phone each lead is a card: the number to tap, the status to set after the
              call and the lead's page, with nothing to scroll sideways for. */}
            <div className="md:hidden" data-lead-cards>
              <label className="flex min-h-11 items-center gap-3 border-b border-line px-4 text-sm text-smoke">
                <input
                  type="checkbox"
                  className="size-5"
                  disabled={pickable.length === 0}
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = somePicked && !allPicked;
                  }}
                  onChange={(e) => pickPage(e.target.checked)}
                />
                Select all {pickable.length}
              </label>
              <ul>
                {shown.map((r) => (
                  <LeadCard
                    key={r.id}
                    row={r}
                    isAdmin={isAdmin}
                    reps={reps}
                    picked={selected.has(r.id)}
                    open={openId === r.id}
                    canPick={canPick(r)}
                    saving={saving === r.id}
                    onPick={(on) => pick(r.id, on)}
                    onOpen={() => setOpenId(r.id)}
                    onStatus={(next) => void setLeadStatus(r, next)}
                    onRep={(slug) => void assignRep(r, slug)}
                  />
                ))}
              </ul>
            </div>
            <table className="hidden w-full min-w-[940px] text-left text-sm md:table">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-smoke">
                <tr>
                  <th className="w-10 py-3 pl-4 pr-0">
                    <input
                      type="checkbox"
                      aria-label="Select every lead on this page"
                      className="size-4 align-middle"
                      disabled={pickable.length === 0}
                      checked={allPicked}
                      ref={(el) => {
                        if (el) el.indeterminate = somePicked && !allPicked;
                      }}
                      onChange={(e) => pickPage(e.target.checked)}
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Tier</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Business</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Where</th>
                  <th className="px-4 py-3 font-semibold">Why</th>
                  <th className="px-4 py-3 font-semibold">Signals</th>
                  <th className="px-4 py-3 font-semibold">Found</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Rep</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    data-engine-lead={r.id}
                    className={cn(
                      "cursor-pointer border-b border-line last:border-0 hover:bg-sand",
                      (selected.has(r.id) || openId === r.id) && "bg-sand",
                    )}
                    // a click anywhere on the lead opens its page; its own controls keep working
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("input,select,a,button,label")) return;
                      setOpenId(r.id);
                    }}
                  >
                    <td className="w-10 py-3 pl-4 pr-0">
                      <input
                        type="checkbox"
                        className="size-4 align-middle disabled:opacity-40"
                        aria-label={`Select ${r.name ?? "lead"}`}
                        title={canPick(r) ? undefined : "Marked do not call"}
                        disabled={!canPick(r)}
                        checked={selected.has(r.id)}
                        onChange={(e) => pick(r.id, e.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {r.tier ?? "—"}
                      {r.need != null && <span className="ml-1 text-xs text-smoke">{r.need}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {(() => {
                        const t = leadType(r.signals);
                        return t ? (
                          <span className="rounded-full bg-sand px-2.5 py-1 font-semibold">
                            {LEAD_TYPE_LABEL[t]}
                          </span>
                        ) : (
                          <span className="text-smoke">—</span>
                        );
                      })()}
                      {tookMca(r.signals) && leadType(r.signals) !== "ucc" && (
                        <div
                          className="mt-1 text-smoke"
                          title="A UCC filing by an MCA funder is on record"
                        >
                          Took an MCA
                        </div>
                      )}
                    </td>
                    <td className="max-w-[16rem] px-4 py-3 font-medium">
                      <div className="truncate">{r.name || "Unnamed business"}</div>
                      {r.industry && (
                        <div className="truncate text-xs text-smoke">{r.industry}</div>
                      )}
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-forest hover:underline"
                        onClick={() => setOpenId(r.id)}
                        data-open-lead={r.id}
                      >
                        Open lead <ChevronRight className="size-3.5" />
                      </button>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {r.phone ? (
                        <a
                          href={`tel:${tel(r.phone)}`}
                          className="underline-offset-4 hover:text-forest hover:underline"
                        >
                          {r.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                      {r.contact_phone && (
                        <div className="text-xs text-smoke">
                          Best:{" "}
                          <a
                            href={`tel:${tel(r.contact_phone)}`}
                            className="underline-offset-4 hover:text-forest hover:underline"
                          >
                            {r.contact_phone}
                          </a>
                        </div>
                      )}
                      {(r.contact_email || r.email) && (
                        <div className="max-w-[12rem] truncate text-xs text-smoke">
                          {r.contact_email || r.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-smoke">
                      {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 text-smoke">
                      {(() => {
                        const w = splitWhy(r.reason);
                        const rest = w.points.map((p) => p.text).join(" · ");
                        return (
                          <button
                            type="button"
                            className="block text-left hover:text-ink"
                            onClick={() => setOpenId(r.id)}
                            title="Open the lead"
                          >
                            {(r.contact_name || w.owner) && (
                              <span className="block truncate font-semibold text-ink">
                                Ask for {r.contact_name || w.owner}
                              </span>
                            )}
                            <span className="line-clamp-2">{rest || (w.owner ? "" : "—")}</span>
                          </button>
                        );
                      })()}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3 text-xs text-smoke">
                      <span className="line-clamp-2">{signalSummary(r.signals) || "—"}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-smoke">
                      {r.first_found ?? age(r.pushed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="rounded-full bg-white px-3 py-1.5 text-xs ring-1 ring-line"
                        value={r.status}
                        disabled={saving === r.id}
                        onChange={(e) => void setLeadStatus(r, e.target.value as EngineStatus)}
                        aria-label={`Status for ${r.name ?? "lead"}`}
                      >
                        {ENGINE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {ENGINE_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                      {r.worked_at && (
                        <span className="ml-2 text-xs tabular-nums text-smoke">
                          {age(r.worked_at)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-smoke">
                      {isAdmin ? (
                        <select
                          className="rounded-full bg-white px-3 py-1.5 text-xs ring-1 ring-line"
                          value={r.rep_slug ?? ""}
                          disabled={saving === r.id}
                          onChange={(e) => void assignRep(r, e.target.value)}
                          aria-label={`Rep for ${r.name ?? "lead"}`}
                        >
                          <option value="">Unassigned</option>
                          {reps.map((p) => (
                            <option key={p.slug} value={p.slug}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        (repName(r.rep_slug) ?? "—")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <Sheet
        open={openRow != null}
        onOpenChange={(o) => {
          if (o) return;
          setOpenId(null);
          // an email being written on this lead's page closes with the page
          setSending((s) => (s?.leadId != null ? null : s));
        }}
      >
        <SheetContent
          side="right"
          // the sheet opens in a portal outside the staff page's themed wrapper, so it carries the
          // same theme classes itself: dark by default, paper in light mode, like the page behind
          className="ll-night ll-calm ll-member w-full overflow-y-auto border-l border-line bg-night text-paper sm:max-w-2xl"
          data-lead-page={openRow?.id}
        >
          {openRow && (
            <LeadPage
              key={openRow.id}
              row={openRow}
              isAdmin={isAdmin}
              reps={reps}
              saving={saving === openRow.id}
              repName={repName(openRow.rep_slug)}
              onStatus={(next) => void setLeadStatus(openRow, next)}
              onRep={(slug) => void assignRep(openRow, slug)}
              onSave={(patch) => saveContact(openRow, patch)}
              onSend={canPick(openRow) ? (kind) => openSend(openRow, kind) : undefined}
              // the email being written shows here, on the lead, not behind this page
              sendPanel={
                sending && sending.leadId === openRow.id ? (
                  <SendApplications
                    key={sending.key}
                    isAdmin={isAdmin}
                    repSlug={repSlug}
                    reps={reps}
                    seed={sending.seed}
                    {...(sending.kind ? { startKind: sending.kind } : {})}
                    onClose={() => setSending(null)}
                    onSent={() => setReload((n) => n + 1)}
                  />
                ) : null
              }
            />
          )}
        </SheetContent>
      </Sheet>

      {selected.size > 0 && (
        <div
          className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.6)] ring-1 ring-line"
          data-lead-selection={selected.size}
        >
          <p className="text-sm font-semibold">
            {selected.size} selected
            {selected.size > MAX_RECIPIENTS && (
              <span className="ml-2 font-normal text-destructive">
                At most {MAX_RECIPIENTS} at a time
              </span>
            )}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(btnPrimary, "px-4 py-2")}
              disabled={selected.size > MAX_RECIPIENTS}
              onClick={() => openSend()}
            >
              <Send className="size-4" /> Send application ({selected.size})
            </button>
            {isAdmin && (
              <button
                type="button"
                className={cn(btnOutline, "px-4 py-2")}
                onClick={downloadCsv}
                data-download-csv
              >
                <Download className="size-4" /> Download CSV ({selected.size})
              </button>
            )}
            <button
              type="button"
              className={cn(btnOutline, "px-4 py-2")}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One lead on a phone: who it is and who to ask for, a full-width button that dials, the status
 * to set after the call, and the way into its page. Everything a rep needs is on screen at 375px;
 * every control is at least 44px tall and selects use 16px type so iPhones don't zoom in.
 */
function LeadCard({
  row: r,
  isAdmin,
  reps,
  picked,
  open,
  canPick,
  saving,
  onPick,
  onOpen,
  onStatus,
  onRep,
}: {
  row: Row;
  isAdmin: boolean;
  reps: { slug: string; name: string }[];
  picked: boolean;
  open: boolean;
  canPick: boolean;
  saving: boolean;
  onPick: (on: boolean) => void;
  onOpen: () => void;
  onStatus: (next: EngineStatus) => void;
  onRep: (slug: string) => void;
}) {
  const type = leadType(r.signals);
  const { sub, ask, why: rest } = leadCardText(r);
  const phoneSelect =
    "min-h-11 w-full rounded-full bg-white px-4 text-base ring-1 ring-line disabled:opacity-50";
  return (
    <li
      className={cn("border-b border-line px-4 py-4 last:border-0", (picked || open) && "bg-sand")}
      data-engine-lead-card={r.id}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 disabled:opacity-40"
          aria-label={`Select ${r.name ?? "lead"}`}
          title={canPick ? undefined : "Marked do not call"}
          disabled={!canPick}
          checked={picked}
          onChange={(e) => onPick(e.target.checked)}
        />
        <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={onOpen}>
          <span className="block font-semibold leading-snug">{r.name || "Unnamed business"}</span>
          <span className="mt-0.5 block text-xs text-smoke">{sub}</span>
        </button>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {r.tier ?? "—"}
          {r.need != null && <span className="ml-1 text-xs font-normal text-smoke">{r.need}</span>}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8 text-xs">
        {type && (
          <span className="rounded-full bg-sand px-2.5 py-1 font-semibold">
            {LEAD_TYPE_LABEL[type]}
          </span>
        )}
        {tookMca(r.signals) && type !== "ucc" && (
          <span className="text-smoke" title="A UCC filing by an MCA funder is on record">
            Took an MCA
          </span>
        )}
        <span className="text-smoke tabular-nums">Found {r.first_found ?? age(r.pushed_at)}</span>
      </div>

      {(ask || rest) && (
        <p className="mt-2 pl-8 text-sm text-smoke">
          {ask && <span className="block font-semibold text-ink">Ask for {ask}</span>}
          {rest && <span className="line-clamp-2">{rest}</span>}
        </p>
      )}

      <div className="mt-3 grid gap-2 pl-8">
        {r.phone && (
          <a href={`tel:${tel(r.phone)}`} className={cn(btnPrimary, "min-h-11 px-4 py-2")}>
            <Phone className="size-4" /> Call {r.phone}
          </a>
        )}
        {r.contact_phone && (
          <a href={`tel:${tel(r.contact_phone)}`} className={cn(btnOutline, "min-h-11 px-4 py-2")}>
            <Phone className="size-4" /> Best number: {r.contact_phone}
          </a>
        )}
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <select
            className={phoneSelect}
            value={r.status}
            disabled={saving}
            onChange={(e) => onStatus(e.target.value as EngineStatus)}
            aria-label={`Status for ${r.name ?? "lead"}`}
          >
            {ENGINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ENGINE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-0.5 rounded-full px-3 text-sm font-semibold text-forest ring-1 ring-line"
            onClick={onOpen}
            data-open-lead-card={r.id}
          >
            Open <ChevronRight className="size-4" />
          </button>
        </div>
        {r.worked_at && (
          <p className="text-xs tabular-nums text-smoke">Status set {age(r.worked_at)}</p>
        )}
        {isAdmin ? (
          <select
            className={phoneSelect}
            value={r.rep_slug ?? ""}
            disabled={saving}
            onChange={(e) => onRep(e.target.value)}
            aria-label={`Rep for ${r.name ?? "lead"}`}
          >
            <option value="">Unassigned</option>
            {reps.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </li>
  );
}

/** A lead as the send panel's first row: the rep's contact first, the engine's after. */
function sendSeed(r: Row): SendSeed {
  const [first = "", ...rest] = (r.contact_name ?? "").trim().split(/\s+/);
  return {
    lead_id: r.id,
    first_name: first,
    last_name: rest.join(" "),
    business_name: r.name ?? "",
    phone: r.contact_phone || r.phone || "",
    email: r.contact_email || r.email || "",
  };
}

/** One lead in full: the contact the rep gets on the call, then everything the engine knows. */
function LeadPage({
  row,
  isAdmin,
  reps,
  saving,
  repName,
  onStatus,
  onRep,
  onSave,
  onSend,
  sendPanel,
}: {
  row: Row;
  isAdmin: boolean;
  reps: { slug: string; name: string }[];
  saving: boolean;
  repName: string | null;
  onStatus: (next: EngineStatus) => void;
  onRep: (slug: string) => void;
  onSave: (patch: ContactPatch) => Promise<string>;
  /** Opens the email to send, on the kind picked. Missing when this lead can't be sent to. */
  onSend?: ((kind: EmailKind) => void) | undefined;
  /** The email being written for this lead, shown under its contact. */
  sendPanel?: ReactNode;
}) {
  const [starting, setStarting] = useState(false);
  const why = splitWhy(row.reason);
  const type = leadType(row.signals);
  const [name, setName] = useState(row.contact_name ?? "");
  const [email, setEmail] = useState(row.contact_email ?? row.email ?? "");
  const [phone, setPhone] = useState(row.contact_phone ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const patch: ContactPatch = {
    contact_name: name.trim() || null,
    contact_email: email.trim().toLowerCase() || null,
    contact_phone: phone.trim() || null,
    notes: notes.trim(),
  };
  const changed =
    patch.contact_name !== (row.contact_name ?? null) ||
    patch.contact_email !== (row.contact_email ?? row.email ?? null) ||
    patch.contact_phone !== (row.contact_phone ?? null) ||
    patch.notes !== (row.notes ?? "").trim();
  const problem =
    patch.contact_email && !EMAIL_RE.test(patch.contact_email)
      ? "That email address doesn't look right."
      : patch.contact_phone && !/^[0-9+()\s.\-x]{7,40}$/.test(patch.contact_phone)
        ? "Numbers only for the best number, like (718) 555-0142."
        : "";

  /**
   * Start application: save what's typed, make this merchant's personal link (no email goes
   * out), and open its paper application in a new tab for the rep to fill in with them on the
   * phone.
   */
  async function startApplication() {
    if (problem) return;
    // opened now, while the click still counts, so the browser doesn't block it as a popup
    const tab = window.open("about:blank", "_blank");
    setStarting(true);
    setMsg(null);
    try {
      if (changed) {
        const err = await onSave(patch);
        if (err) throw new Error(err);
      }
      const seed = sendSeed({ ...row, ...patch });
      const [res] = await postInvites({
        action: "send",
        ...(isAdmin && row.rep_slug ? { rep_slug: row.rep_slug } : {}),
        recipients: [{ ...seed, channel: "link" }],
      });
      if (!res?.url) throw new Error(res?.detail || "Couldn't make the application link.");
      // the paper application, the one-page form Stevie prefers, in the rep's fill-in mode
      const paper = paperLink(res.url);
      const url = `${paper}${paper.includes("?") ? "&" : "?"}fill=rep`;
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setMsg({ ok: true, text: "Paper application opened in a new tab. Fill it in with them." });
    } catch (e) {
      tab?.close();
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't start it. Try again." });
    } finally {
      setStarting(false);
    }
  }

  async function save() {
    if (problem || !changed) return;
    setBusy(true);
    setMsg(null);
    const err = await onSave(patch);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved." });
  }

  const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke";
  return (
    <div className="pb-10">
      <SheetHeader className="pr-8">
        <SheetTitle className="font-display text-2xl">{row.name || "Unnamed business"}</SheetTitle>
        <SheetDescription className="text-smoke">
          {[row.industry, [row.city, row.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" · ")}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          {type && (
            <span className="rounded-full bg-sand px-2.5 py-1 font-semibold">
              {LEAD_TYPE_LABEL[type]}
            </span>
          )}
          {tookMca(row.signals) && type !== "ucc" && (
            <span className="rounded-full bg-sand px-2.5 py-1 font-semibold">Took an MCA</span>
          )}
          <span className="rounded-full bg-sand px-2.5 py-1 font-semibold">
            Tier {row.tier ?? "—"}
          </span>
          <span className="text-smoke">Found {row.first_found ?? age(row.pushed_at)}</span>
        </div>
      </SheetHeader>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {row.phone && (
          <a
            href={`tel:${tel(row.phone)}`}
            className={cn(btnPrimary, "px-4 py-2 max-md:min-h-11 max-md:w-full")}
          >
            <Phone className="size-4" /> {row.phone}
          </a>
        )}
        {row.contact_phone && (
          <a
            href={`tel:${tel(row.contact_phone)}`}
            className={cn(btnOutline, "px-4 py-2 max-md:min-h-11 max-md:w-full")}
          >
            <Phone className="size-4" /> Best: {row.contact_phone}
          </a>
        )}
        <select
          className="rounded-full bg-white px-3 py-2 text-sm ring-1 ring-line max-md:min-h-11 max-md:flex-1 max-md:text-base"
          value={row.status}
          disabled={saving}
          onChange={(e) => onStatus(e.target.value as EngineStatus)}
          aria-label="Status"
        >
          {ENGINE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ENGINE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {isAdmin ? (
          <select
            className="rounded-full bg-white px-3 py-2 text-sm ring-1 ring-line max-md:min-h-11 max-md:flex-1 max-md:text-base"
            value={row.rep_slug ?? ""}
            disabled={saving}
            onChange={(e) => onRep(e.target.value)}
            aria-label="Rep"
          >
            <option value="">Unassigned</option>
            {reps.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          repName && <span className="text-sm text-smoke">Rep: {repName}</span>
        )}
      </div>

      <section className={cn(card, "mt-5 p-5")} data-lead-contact>
        <h3 className="text-sm font-semibold">What you got on the call</h3>
        <p className="mt-1 text-xs text-smoke">
          Saved on this lead for you and your admins. The engine never overwrites it. Start
          application opens their application to fill in together on the phone; they sign it from
          the link you send at the end.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className={label}>Who you spoke to</span>
            <input
              className={input}
              value={name}
              maxLength={120}
              placeholder={why.owner ? `e.g. ${why.owner}` : "Owner or decision maker"}
              onChange={(e) => setName(e.target.value)}
              data-contact-name
            />
          </label>
          <label className="block text-sm">
            <span className={label}>Email for the application</span>
            <input
              className={input}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              maxLength={200}
              placeholder="owner@business.com"
              onChange={(e) => setEmail(e.target.value)}
              data-contact-email
            />
          </label>
          <label className="block text-sm">
            <span className={label}>Best number to reach them</span>
            <input
              className={input}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              maxLength={40}
              placeholder="Their cell, if they gave it"
              onChange={(e) => setPhone(e.target.value)}
              data-contact-phone
            />
          </label>
          <div className="text-sm sm:col-span-2">
            <label className="block">
              <span className={label}>Notes</span>
              <textarea
                className={textarea}
                value={notes}
                maxLength={2000}
                placeholder="What they need, how much, how soon, when to call back"
                onChange={(e) => setNotes(e.target.value)}
                data-contact-notes
              />
            </label>
            <SpeakButton
              className="mt-2"
              onPhrase={(said) => setNotes((n) => fitTo(joinSpoken(n, said), 2000))}
            />
          </div>
        </div>
        {problem && <p className="mt-3 text-sm text-destructive">{problem}</p>}
        {msg && (
          <p className={cn("mt-3 text-sm", msg.ok ? "text-forest" : "text-destructive")}>
            {msg.text}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {onSend && (
            <button
              type="button"
              className={cn(btnPrimary, "px-5 py-2 max-md:min-h-11")}
              disabled={starting || busy || !!problem}
              onClick={() => void startApplication()}
              data-start-application
            >
              {starting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FilePen className="size-4" />
              )}{" "}
              Start application
            </button>
          )}
          <button
            type="button"
            className={cn(btnOutline, "px-5 py-2 max-md:min-h-11")}
            disabled={busy || !changed || !!problem}
            onClick={() => void save()}
            data-contact-save
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </button>
          {row.contact_updated_at && (
            <span className="text-xs text-smoke">
              Contact updated {age(row.contact_updated_at)}
            </span>
          )}
        </div>
        {onSend && (
          <div className="mt-5 border-t border-line pt-4" data-quick-emails>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-smoke">
              <Send className="size-3.5" aria-hidden /> Send an email
            </p>
            <p className="mt-1 text-xs text-smoke">
              {changed
                ? "Save the contact first, then pick the email."
                : "Pick the one that matches what just happened. You read it before it goes."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EMAIL_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={cn(chip, "min-h-11 px-4")}
                  disabled={changed}
                  title={EMAIL_KIND_LABEL[k].when}
                  onClick={() => onSend(k)}
                  data-quick-email={k}
                >
                  {EMAIL_KIND_LABEL[k].short}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      {sendPanel}

      <div className="mt-6">
        <LeadDetail row={row} />
      </div>
    </div>
  );
}

/** Everything the engine knows about one lead, laid out for the call. */
function LeadDetail({ row }: { row: Row }) {
  const why = splitWhy(row.reason);
  const records = leadRecords(row.signals);
  const type = leadType(row.signals);
  const approach = [
    ...(type ? [LEAD_APPROACH[type]] : []),
    ...(type !== "ucc" && tookMca(row.signals) ? [LEAD_APPROACH.ucc] : []),
  ];
  const head = "text-xs font-semibold uppercase tracking-wide text-smoke";
  return (
    <div className="grid gap-6 text-sm sm:grid-cols-2" data-lead-detail={row.id}>
      <SmartLeadCard row={row} owner={why.owner} type={type} approach={approach} />

      <section>
        <h4 className={head}>Who to ask for</h4>
        {why.owner ? (
          <>
            <p className="mt-2 text-base font-semibold">{why.owner}</p>
            {why.ownerFrom && (
              <p className="mt-0.5 text-xs text-smoke">From public records: {why.ownerFrom}</p>
            )}
            {why.alsoOwner && (
              <p className="mt-1 text-xs text-smoke">Also named: {why.alsoOwner}</p>
            )}
            <p className="mt-2 text-xs text-smoke">
              Ask for them by name. If someone else answers, ask who handles the money side.
            </p>
          </>
        ) : (
          <p className="mt-2 text-smoke">
            No owner name in the public records yet. Ask for the owner, or whoever handles the
            finances, and note the name for next time.
          </p>
        )}
        <dl className="mt-3 space-y-1 text-xs text-smoke">
          {row.industry && (
            <div>
              <dt className="inline font-semibold">Business: </dt>
              <dd className="inline">{row.industry}</dd>
            </div>
          )}
          {(row.city || row.state) && (
            <div>
              <dt className="inline font-semibold">Where: </dt>
              <dd className="inline">{[row.city, row.state].filter(Boolean).join(", ")}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-semibold">Tier: </dt>
            <dd className="inline">
              {row.tier ?? "—"}
              {row.tier === "A" && " (dial first)"}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h4 className={head}>Why it was picked</h4>
        {why.points.length ? (
          <ul className="mt-2 space-y-2">
            {why.points.map((p) => (
              <li key={p.text}>
                <span className="font-medium">{p.text}</span>
                {p.means && <span className="block text-xs text-smoke">{p.means}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-smoke">The engine gave no reason for this one.</p>
        )}
      </section>

      <section>
        <h4 className={head}>On the public record</h4>
        {records.length ? (
          <ul className="mt-2 space-y-2">
            {records.map((x) => (
              <li key={`${x.label}|${x.date}|${x.detail}`}>
                <span className="font-medium">{x.label}</span>
                {x.date && <span className="ml-1.5 text-xs tabular-nums text-smoke">{x.date}</span>}
                {x.detail && <span className="block text-xs text-smoke">{x.detail}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-smoke">No records came with this lead.</p>
        )}
      </section>
    </div>
  );
}

/**
 * Smart lead: the cheat sheet for this call. What's going on in their trade this month, why this
 * lead now, an opener, who they are, how they'd use the money, their words, what they'll push back
 * with, and where they start on the 5 levels. Built from written playbooks (src/lib/smart-lead.ts)
 * and the lead's own records, so it's the same every time and costs nothing.
 */
function SmartLeadCard({
  row,
  owner,
  type,
  approach,
}: {
  row: Row;
  owner: string | null;
  type: LeadType | null;
  approach: { why: string; ask: string }[];
}) {
  const s = smartLead(
    { industry: row.industry, city: row.city, state: row.state, signals: row.signals, owner },
    type,
    new Date(),
  );
  const [copied, setCopied] = useState(false);
  const head = "text-xs font-semibold uppercase tracking-wide text-smoke";
  async function copy() {
    try {
      await navigator.clipboard.writeText(s.opener);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the text is on screen */
    }
  }
  return (
    <section
      className="rounded-2xl bg-sand/60 p-4 ring-1 ring-line sm:col-span-2 sm:p-5"
      data-smart-lead={s.book.key}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 font-display text-base font-semibold">
          <Sparkles className="size-4 text-forest" /> Smart lead
        </h4>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold ring-1 ring-line">
          {s.book.label.replace(/^an? /, "")} · {s.month}
        </span>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <p className={head}>Their world in {s.month}</p>
          <p className="mt-1.5">{s.now.now}</p>
          <p className="mt-1.5 text-smoke">
            <span className="font-semibold text-ink">So the money is for: </span>
            {s.now.use}
          </p>
        </div>
        <div>
          <p className={head}>Why this lead, why now</p>
          <ul className="mt-1.5 space-y-1.5">
            {s.timing.map((t) => (
              <li key={t}>{t}</li>
            ))}
            {approach.map((a) => (
              <li key={a.ask} className="text-smoke">
                {a.why} <span className="font-medium text-ink">{a.ask}</span>
              </li>
            ))}
            {!s.timing.length && !approach.length && (
              <li className="text-smoke">
                No timing in its records: lead with the season, and ask what's coming up for them.
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <p className={head}>Open with</p>
          <button type="button" className={chip} onClick={() => void copy()} data-smart-copy>
            <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p
          className="mt-1.5 rounded-xl bg-white p-3 leading-relaxed ring-1 ring-line"
          data-smart-opener
        >
          &ldquo;{s.opener}&rdquo;
        </p>
        <p className="mt-1.5 text-xs text-smoke">
          They start around{" "}
          <span className="font-semibold">
            level {s.level.n}, {s.level.name}
          </span>
          . {s.level.move}
        </p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className={head}>Who they are</p>
          <p className="mt-1.5">{s.book.who}</p>
          <p className={cn(head, "mt-4")}>How they&apos;d use it</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {s.book.uses.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className={head}>Talk their language</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {s.book.language.map((w) => (
              <li key={w} className="rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-line">
                {w}
              </li>
            ))}
          </ul>
          <p className={cn(head, "mt-4")}>If they say</p>
          <ul className="mt-1.5 space-y-2.5">
            {s.book.pushback.map((p) => (
              <li key={p.they}>
                <span className="font-medium">&ldquo;{p.they}&rdquo;</span>
                <span className="block text-smoke">{p.you}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Admin only: upload the CSV the Board downloads for Lamp. Each lead goes to the rep in the
 * file's rep_slug column, or to one rep picked here for the whole file. A lead already in Lamp
 * (same source and key) is only reassigned; what a rep has recorded on it stays.
 *
 * The Board's "send to Lamp" opens this page and hands it the same file instead (see
 * BOARD_ORIGINS): it lands here as if chosen, the admin presses Upload, and the Board hears
 * how it went so it marks the batch sent, or undoes it if nothing went in.
 */
function UploadLeads({
  reps,
  onDone,
}: {
  reps: { slug: string; name: string }[];
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [rep, setRep] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  // the Board batch waiting here, and where to tell the Board how it went
  const [board, setBoard] = useState<{ batch: number; origin: string } | null>(null);
  const parsed = text
    ? leadsFromCsv(
        text,
        reps.map((r) => r.slug),
        rep || null,
      )
    : null;

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;
    const receive = (e: MessageEvent) => {
      if (!(BOARD_ORIGINS as readonly string[]).includes(e.origin) || e.source !== opener) return;
      const b = boardBatch(e.data);
      if (!b) return;
      setText(b.csv);
      setFileName(b.label);
      setResult("");
      setBoard({ batch: b.batch, origin: e.origin });
      document.querySelector("[data-upload-leads]")?.scrollIntoView({ block: "center" });
    };
    window.addEventListener("message", receive);
    // only the origin that matches the opener receives this; the others are dropped
    for (const origin of BOARD_ORIGINS) {
      try {
        opener.postMessage({ type: "lamp-board:ready" }, origin);
      } catch {
        // the opener closed
      }
    }
    return () => window.removeEventListener("message", receive);
  }, []);

  function tellBoard(msg: Record<string, unknown>) {
    if (!board) return;
    try {
      (window.opener as Window | null)?.postMessage({ ...msg, batch: board.batch }, board.origin);
    } catch {
      // the Board tab closed; its batch stays as recorded
    }
  }

  async function upload() {
    const sb = getSupabase();
    if (!sb || !parsed || parsed.leads.length === 0) return;
    setBusy(true);
    setResult("");
    let done = 0;
    for (let i = 0; i < parsed.leads.length; i += 200) {
      const chunk = parsed.leads.slice(i, i + 200);
      const { error } = await sb
        .from("engine_leads")
        .upsert(chunk as TablesInsert<"engine_leads">[], { onConflict: "source,source_key" });
      if (error) {
        setBusy(false);
        setResult(`Stopped after ${done} of ${parsed.leads.length}: ${error.message}`);
        tellBoard({ type: "lamp-board:failed", count: done, error: error.message });
        if (done) onDone();
        return;
      }
      done += chunk.length;
    }
    setBusy(false);
    setResult(
      `Handed out ${done} lead${done === 1 ? "" : "s"}.` +
        (board ? " The Board has them marked sent; you can close this tab." : ""),
    );
    tellBoard({ type: "lamp-board:done", count: done });
    setBoard(null);
    setText("");
    setFileName("");
    onDone();
  }

  const perRep = parsed
    ? Object.entries(
        parsed.leads.reduce<Record<string, number>>(
          (m, l) => ({ ...m, [l.rep_slug]: (m[l.rep_slug] ?? 0) + 1 }),
          {},
        ),
      )
        .map(([slug, n]) => `${reps.find((r) => r.slug === slug)?.name ?? slug} ${n}`)
        .join(" · ")
    : "";

  return (
    <div className={cn(card, "mt-4 p-5")} data-upload-leads>
      <p className="text-sm font-semibold">Hand out leads</p>
      <p className="mt-1 text-xs text-smoke">
        On the Board, tick the leads, pick a rep and press send to Lamp: they arrive here. Or
        download the file there and choose it here.
      </p>
      {board && (
        <p
          className="mt-3 rounded-xl bg-leaf/15 px-4 py-2.5 text-sm"
          data-board-batch={board.batch}
        >
          From the Board: batch #{board.batch}. Check the rep, then press Upload to hand them out.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-line hover:ring-ink/40">
          {fileName || "Choose CSV file"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              setResult("");
              if (!f) return;
              setFileName(f.name);
              setText(await f.text());
              setBoard(null);
            }}
          />
        </label>
        <select
          className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
          value={rep}
          onChange={(e) => setRep(e.target.value)}
          aria-label="Rep for the whole file"
        >
          <option value="">Rep from the file</option>
          {reps.map((r) => (
            <option key={r.slug} value={r.slug}>
              All to {r.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={cn(btnPrimary, "px-4 py-2 disabled:opacity-40")}
          disabled={busy || !parsed || parsed.leads.length === 0}
          onClick={() => void upload()}
        >
          {busy
            ? "Uploading…"
            : parsed
              ? `Upload ${parsed.leads.length} lead${parsed.leads.length === 1 ? "" : "s"}`
              : "Upload"}
        </button>
        {perRep && <span className="text-xs text-smoke">{perRep}</span>}
      </div>
      {parsed && parsed.problems.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-destructive">
          {parsed.problems.slice(0, 8).map((p) => (
            <li key={p}>{p}</li>
          ))}
          {parsed.problems.length > 8 && <li>and {parsed.problems.length - 8} more.</li>}
        </ul>
      )}
      {result && <p className="mt-3 text-sm">{result}</p>}
    </div>
  );
}

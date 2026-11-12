import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { tel } from "@/lib/engine-leads";
import { btnPrimary, card } from "@/components/site/layout";
import { Field } from "@/components/staff/fields";
import { chip, chipDark, input, textarea } from "@/components/staff/field-styles";
import {
  ENTRY_COLUMNS,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUSES,
  entriesFromCsv,
  groupEntries,
  importStatus,
  mailHref,
  matches,
  nameKey,
  planImport,
  siteHref,
  statusAfter,
  statusCounts,
  TOUCH_COLUMNS,
  TOUCH_KINDS,
  TOUCH_LABEL,
  type EntryRow,
  type EntryStatus,
  type ListRow,
  type TouchKind,
  type TouchRow,
} from "@/lib/private-lists";

/**
 * My lists: prospect lists that belong to the person signed in, and to no one else. The database
 * returns a list, its businesses and its log only to their owner ("Owner reads own lists"), so
 * an admin sees nothing of another person's here. Each business carries a log of emails, calls
 * and replies.
 */

type Draft = Record<
  "business" | "contact" | "phone" | "email" | "website" | "area" | "grp" | "notes",
  string
>;
const EMPTY: Draft = {
  business: "",
  contact: "",
  phone: "",
  email: "",
  website: "",
  area: "",
  grp: "",
  notes: "",
};
const toDraft = (e: EntryRow): Draft => ({
  business: e.business,
  contact: e.contact ?? "",
  phone: e.phone ?? "",
  email: e.email ?? "",
  website: e.website ?? "",
  area: e.area ?? "",
  grp: e.grp ?? "",
  notes: e.notes,
});
const orNull = (s: string) => s.trim() || null;
const fromDraft = (d: Draft) => ({
  business: d.business.trim(),
  contact: orNull(d.contact),
  phone: orNull(d.phone),
  email: orNull(d.email),
  website: orNull(d.website),
  area: orNull(d.area),
  grp: orNull(d.grp),
  notes: d.notes.trim(),
});

/** <input type="datetime-local"> wants local time without a zone. */
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const statusTone: Record<EntryStatus, string> = {
  new: "text-smoke ring-1 ring-line",
  emailed: "text-forest ring-1 ring-line",
  called: "text-forest ring-1 ring-line",
  replied: "bg-leaf text-ink",
  talking: "bg-leaf text-ink",
  won: "bg-ink text-white",
  dead: "text-destructive ring-1 ring-line",
};

export function MyLists({ onChanged }: { onChanged?: () => void }) {
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [listId, setListId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [touches, setTouches] = useState<TouchRow[]>([]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EntryStatus | "">("");
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [logging, setLogging] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("private_lists")
      .select("id,name,note,created_at")
      .order("created_at")
      .then(({ data, error: e }) => {
        if (e) {
          // before the private_lists migration is run there is no such table
          setMissing(true);
          setLists([]);
          return;
        }
        const rows = (data as ListRow[] | null) ?? [];
        setLists(rows);
        setListId((cur) => (cur && rows.some((l) => l.id === cur) ? cur : (rows[0]?.id ?? null)));
      });
  }, [reload]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !listId) {
      setEntries(listId ? null : []);
      return;
    }
    let off = false;
    void (async () => {
      const [e, t] = await Promise.all([
        sb
          .from("private_list_entries")
          .select(ENTRY_COLUMNS)
          .eq("list_id", listId)
          .order("position")
          .order("business"),
        // every log row this person owns; the ones for other lists are dropped below
        sb
          .from("private_list_touches")
          .select(TOUCH_COLUMNS)
          .order("happened_at", { ascending: false })
          .limit(2000),
      ]);
      if (off) return;
      if (e.error || t.error) setError("Couldn't load this list. Refresh to try again.");
      const rows = (e.data as EntryRow[] | null) ?? [];
      const ids = new Set(rows.map((r) => r.id));
      setEntries(rows);
      setTouches(((t.data as TouchRow[] | null) ?? []).filter((x) => ids.has(x.entry_id)));
    })();
    return () => {
      off = true;
    };
  }, [listId, reload]);

  const list = lists?.find((l) => l.id === listId) ?? null;
  const shown = useMemo(
    () => (entries ?? []).filter((e) => (!status || e.status === status) && matches(e, query)),
    [entries, status, query],
  );
  const counts = useMemo(() => statusCounts(entries ?? []), [entries]);
  const byEntry = useMemo(() => {
    const m = new Map<string, TouchRow[]>();
    for (const t of touches) m.set(t.entry_id, [...(m.get(t.entry_id) ?? []), t]);
    return m;
  }, [touches]);
  const nameOf = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e.business])), [entries]);
  const refresh = () => setReload((n) => n + 1);

  async function createList() {
    const sb = getSupabase();
    const name = newName.trim();
    if (!sb || !name) return;
    setBusy(true);
    setError("");
    const { data, error: e } = await sb
      .from("private_lists")
      .insert({ name })
      .select("id")
      .single();
    setBusy(false);
    if (e || !data) {
      setError(
        e?.code === "23505"
          ? `You already have a list called "${name}".`
          : "Couldn't create the list. Refresh and try again.",
      );
      return;
    }
    setNewName("");
    setListId(data.id);
    refresh();
    onChanged?.();
  }

  async function renameList() {
    const sb = getSupabase();
    if (!sb || !list) return;
    const name = window.prompt("Name for this list", list.name)?.trim();
    if (!name || name === list.name) return;
    const { error: e } = await sb.from("private_lists").update({ name }).eq("id", list.id);
    if (e) setError("Couldn't rename the list.");
    refresh();
  }

  async function deleteList() {
    const sb = getSupabase();
    if (!sb || !list) return;
    const n = entries?.length ?? 0;
    if (
      !window.confirm(
        `Delete "${list.name}"?\n\nIts ${n} business${n === 1 ? "" : "es"} and their whole log go with it. This can't be undone.`,
      )
    )
      return;
    const { error: e } = await sb.from("private_lists").delete().eq("id", list.id);
    if (e) setError("Couldn't delete the list.");
    setListId(null);
    refresh();
    onChanged?.();
  }

  async function saveEntry() {
    const sb = getSupabase();
    if (!sb || !list || !editing) return;
    const row = fromDraft(draft);
    if (!row.business) {
      setError("A business needs a name.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: e } =
      editing === "new"
        ? await sb
            .from("private_list_entries")
            .insert({ ...row, list_id: list.id, position: entries?.length ?? 0 })
        : await sb.from("private_list_entries").update(row).eq("id", editing);
    setBusy(false);
    if (e) {
      setError(
        e.code === "23505"
          ? `"${row.business}" is already on this list.`
          : "Couldn't save. Refresh and try again.",
      );
      return;
    }
    setEditing(null);
    refresh();
  }

  async function removeEntry(e: EntryRow) {
    const sb = getSupabase();
    if (!sb) return;
    if (!window.confirm(`Take ${e.business} off this list? Its log goes with it.`)) return;
    const { error: err } = await sb.from("private_list_entries").delete().eq("id", e.id);
    if (err) setError("Couldn't remove it.");
    setEditing(null);
    refresh();
  }

  async function setEntryStatus(e: EntryRow, next: EntryStatus) {
    const sb = getSupabase();
    if (!sb || next === e.status) return;
    const { error: err } = await sb
      .from("private_list_entries")
      .update({ status: next })
      .eq("id", e.id);
    if (err) setError("Couldn't change the status.");
    refresh();
  }

  async function removeTouch(t: TouchRow) {
    const sb = getSupabase();
    if (!sb) return;
    if (!window.confirm("Remove this line from the log?")) return;
    const { error: err } = await sb.from("private_list_touches").delete().eq("id", t.id);
    if (err) setError("Couldn't remove it.");
    refresh();
  }

  if (lists === null) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-smoke" />
      </div>
    );
  }

  if (missing) {
    return (
      <p className="mt-8 text-sm text-smoke" data-my-lists="not-set-up">
        My lists isn't switched on yet: its database step hasn't been run.
      </p>
    );
  }

  return (
    <div className="mt-6" data-my-lists={list ? "list" : "empty"}>
      <p className="max-w-2xl text-sm text-smoke">
        Lists here are yours alone. No one else on the team can open them, admins included.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            className={l.id === listId ? chipDark : chip}
            onClick={() => {
              setListId(l.id);
              setEditing(null);
              setLogging(null);
              setImporting(false);
            }}
          >
            {l.name}
          </button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createList();
          }}
        >
          <input
            className={cn(input, "w-48")}
            placeholder="New list name"
            aria-label="New list name"
            maxLength={80}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className={chipDark} disabled={busy || !newName.trim()}>
            Create list
          </button>
        </form>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {list && (
        <>
          <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold tracking-tight">{list.name}</h2>
              <p className="mt-1 text-sm text-smoke" data-my-lists-counts>
                {entries?.length ?? 0} business{entries?.length === 1 ? "" : "es"}
                {ENTRY_STATUSES.filter((s) => s !== "new" && counts[s] > 0).map(
                  (s) => ` · ${counts[s]} ${ENTRY_STATUS_LABEL[s].toLowerCase()}`,
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={chipDark}
                onClick={() => {
                  setDraft(EMPTY);
                  setEditing("new");
                }}
              >
                Add a business
              </button>
              <button type="button" className={chip} onClick={() => setImporting((v) => !v)}>
                Import a CSV
              </button>
              <button type="button" className={chip} onClick={() => void renameList()}>
                Rename
              </button>
              <button
                type="button"
                className={cn(chip, "text-destructive")}
                onClick={() => void deleteList()}
              >
                Delete list
              </button>
            </div>
          </div>

          {importing && (
            <ImportCsv
              listId={list.id}
              entries={entries ?? []}
              touches={touches}
              onDone={() => {
                setImporting(false);
                refresh();
              }}
            />
          )}

          {editing === "new" && (
            <EntryForm
              title="Add a business"
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              onSave={() => void saveEntry()}
              onCancel={() => setEditing(null)}
            />
          )}

          {touches.length > 0 && (
            <details className={cn(card, "mt-6")} open data-my-lists-log>
              <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
                Log ({touches.length})
              </summary>
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-smoke">
                    <tr>
                      <th className="px-5 py-2 font-semibold">When</th>
                      <th className="px-3 py-2 font-semibold">What</th>
                      <th className="px-3 py-2 font-semibold">Business</th>
                      <th className="px-3 py-2 font-semibold">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {touches.slice(0, 50).map((t) => (
                      <tr key={t.id} className="border-t border-line">
                        <td className="whitespace-nowrap px-5 py-2 text-smoke">
                          {stamp(t.happened_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{TOUCH_LABEL[t.kind]}</td>
                        <td className="px-3 py-2 font-semibold">{nameOf.get(t.entry_id)}</td>
                        <td className="px-3 py-2 text-smoke">
                          {[t.detail, t.to_address && `to ${t.to_address}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <input
              className={cn(input, "w-full sm:w-72")}
              placeholder="Search business, contact or area"
              aria-label="Search this list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className={status === "" ? chipDark : chip}
              onClick={() => setStatus("")}
            >
              All
            </button>
            {ENTRY_STATUSES.filter((s) => counts[s] > 0).map((s) => (
              <button
                key={s}
                type="button"
                className={status === s ? chipDark : chip}
                onClick={() => setStatus(status === s ? "" : s)}
              >
                {ENTRY_STATUS_LABEL[s]} {counts[s]}
              </button>
            ))}
          </div>

          {entries === null ? (
            <div className="grid place-items-center py-16">
              <Loader2 className="size-6 animate-spin text-smoke" />
            </div>
          ) : entries.length === 0 ? (
            <p className={cn(card, "mt-4 px-6 py-12 text-center text-sm text-smoke")}>
              Nothing on this list yet. Add a business, or import a CSV with a "business" column.
            </p>
          ) : shown.length === 0 ? (
            <p className={cn(card, "mt-4 px-6 py-12 text-center text-sm text-smoke")}>
              Nothing matches. Clear the search or pick All.
            </p>
          ) : (
            groupEntries(shown).map((g) => (
              <section key={g.name || "all"} className="mt-6">
                {g.name && (
                  <h3 className="text-sm font-semibold">
                    {g.name} <span className="font-normal text-smoke">{g.entries.length}</span>
                  </h3>
                )}
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {g.entries.map((e) =>
                    editing === e.id ? (
                      <EntryForm
                        key={e.id}
                        title={`Edit ${e.business}`}
                        draft={draft}
                        setDraft={setDraft}
                        busy={busy}
                        onSave={() => void saveEntry()}
                        onCancel={() => setEditing(null)}
                        onRemove={() => void removeEntry(e)}
                        inGrid
                      />
                    ) : (
                      <EntryCard
                        key={e.id}
                        entry={e}
                        touches={byEntry.get(e.id) ?? []}
                        logging={logging === e.id}
                        onLog={() => setLogging(logging === e.id ? null : e.id)}
                        onLogged={() => {
                          setLogging(null);
                          refresh();
                        }}
                        onEdit={() => {
                          setDraft(toDraft(e));
                          setEditing(e.id);
                        }}
                        onStatus={(s) => void setEntryStatus(e, s)}
                        onRemoveTouch={(t) => void removeTouch(t)}
                      />
                    ),
                  )}
                </div>
              </section>
            ))
          )}
        </>
      )}

      {!list && lists.length === 0 && (
        <p className={cn(card, "mt-6 px-6 py-12 text-center text-sm text-smoke")}>
          You have no lists yet. Name one above to start it.
        </p>
      )}
    </div>
  );
}

function EntryCard({
  entry: e,
  touches,
  logging,
  onLog,
  onLogged,
  onEdit,
  onStatus,
  onRemoveTouch,
}: {
  entry: EntryRow;
  touches: TouchRow[];
  logging: boolean;
  onLog: () => void;
  onLogged: () => void;
  onEdit: () => void;
  onStatus: (s: EntryStatus) => void;
  onRemoveTouch: (t: TouchRow) => void;
}) {
  const site = siteHref(e.website);
  const mail = mailHref(e.email);
  const phone = tel(e.phone);
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [e.business, e.area].filter(Boolean).join(" "),
  )}`;
  return (
    <article className={cn(card, "p-4")} data-my-lists-entry={e.id}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 font-display text-base font-bold">{e.business}</h4>
        <select
          aria-label={`Status of ${e.business}`}
          className={cn(
            "shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold",
            statusTone[e.status],
          )}
          value={e.status}
          onChange={(ev) => onStatus(ev.target.value as EntryStatus)}
        >
          {ENTRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ENTRY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {e.contact && <p className="mt-1 text-sm font-semibold">{e.contact}</p>}
      {e.area && <p className="text-xs text-smoke">{e.area}</p>}
      {e.notes && <p className="mt-2 whitespace-pre-line text-sm text-smoke">{e.notes}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {phone && (
          <a className={chip} href={`tel:${phone}`}>
            Call {e.phone}
          </a>
        )}
        {mail && (
          <a className={chip} href={mail} title={e.email ?? undefined}>
            Email
          </a>
        )}
        {site && (
          <a className={chip} href={site} target="_blank" rel="noopener noreferrer">
            Website
          </a>
        )}
        <a className={chip} href={map} target="_blank" rel="noopener noreferrer">
          Map
        </a>
        <button type="button" className={chipDark} onClick={onLog}>
          {logging ? "Close" : "Log"}
        </button>
        <button type="button" className={chip} onClick={onEdit}>
          Edit
        </button>
      </div>
      {e.email && <p className="mt-2 break-all text-xs text-smoke">{e.email}</p>}
      {logging && <LogForm entry={e} onDone={onLogged} />}
      {touches.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
          {touches.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="font-semibold">{TOUCH_LABEL[t.kind]}</span>{" "}
                <span className="text-smoke">
                  {stamp(t.happened_at)}
                  {t.detail ? ` · ${t.detail}` : ""}
                  {t.to_address ? ` · to ${t.to_address}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="shrink-0 text-smoke hover:text-destructive"
                aria-label="Remove this line from the log"
                onClick={() => onRemoveTouch(t)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

const DETAIL_LABEL: Record<TouchKind, string> = {
  email: "Subject",
  call: "What happened",
  reply: "What they said",
  note: "Note",
};

function LogForm({ entry, onDone }: { entry: EntryRow; onDone: () => void }) {
  const [kind, setKind] = useState<TouchKind>("email");
  const [when, setWhen] = useState(localNow);
  const [detail, setDetail] = useState("");
  const [to, setTo] = useState(entry.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const sb = getSupabase();
    if (!sb) return;
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) {
      setError("Pick a date and time.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: e } = await sb.from("private_list_touches").insert({
      entry_id: entry.id,
      kind,
      happened_at: at.toISOString(),
      detail: detail.trim() || null,
      to_address: kind === "email" ? to.trim() || null : null,
    });
    if (e) {
      setSaving(false);
      setError("Couldn't save. Refresh and try again.");
      return;
    }
    const next = statusAfter(entry.status, kind);
    if (next !== entry.status)
      await sb.from("private_list_entries").update({ status: next }).eq("id", entry.id);
    setSaving(false);
    onDone();
  }

  return (
    <form
      className="mt-3 grid gap-2 rounded-xl bg-sand p-3"
      data-my-lists-logform
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {TOUCH_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={kind === k ? chipDark : chip}
            onClick={() => setKind(k)}
          >
            {TOUCH_LABEL[k]}
          </button>
        ))}
      </div>
      <Field label="When">
        <input
          type="datetime-local"
          className={input}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </Field>
      <Field label={DETAIL_LABEL[kind]}>
        <input
          className={input}
          maxLength={2000}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
      </Field>
      {kind === "email" && (
        <Field label="Sent to">
          <input
            className={input}
            maxLength={200}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div>
        <button type="submit" className={chipDark} disabled={saving}>
          {saving ? "Saving…" : "Save to log"}
        </button>
      </div>
    </form>
  );
}

function EntryForm({
  title,
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
  onRemove,
  inGrid = false,
}: {
  title: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  onRemove?: () => void;
  inGrid?: boolean;
}) {
  const set = (k: keyof Draft) => (v: string) => setDraft({ ...draft, [k]: v });
  const text = (k: keyof Draft, label: string, max: number, hint?: string) => (
    <Field label={label} {...(hint ? { hint } : {})}>
      <input
        className={input}
        maxLength={max}
        value={draft[k]}
        onChange={(e) => set(k)(e.target.value)}
      />
    </Field>
  );
  return (
    <form
      className={cn(card, "p-4", !inGrid && "mt-6")}
      data-my-lists-form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <h4 className="font-display text-base font-bold">{title}</h4>
      <div className={cn("mt-3 grid gap-3", !inGrid && "sm:grid-cols-2")}>
        {text("business", "Business", 200)}
        {text("contact", "Owner or contact", 200)}
        {text("phone", "Phone", 40)}
        {text("email", "Email", 200)}
        {text("website", "Website", 300)}
        {text("area", "Area", 200)}
        {text("grp", "Group", 80, "A heading to file it under, like Tier 1.")}
        <Field label="Notes" wide={!inGrid}>
          <textarea
            className={textarea}
            maxLength={4000}
            value={draft.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="submit" className={chipDark} disabled={busy || !draft.business.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className={chip} onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className={cn(chip, "ml-auto text-destructive")} onClick={onRemove}>
            Remove from list
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Import a CSV into the open list. A business already on the list (same name) is updated, not
 * doubled; an `emailed_at` cell adds a line to the log unless that email is already there.
 */
function ImportCsv({
  listId,
  entries,
  touches,
  onDone,
}: {
  listId: string;
  entries: EntryRow[];
  touches: TouchRow[];
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const parsed = useMemo(() => (text ? entriesFromCsv(text) : null), [text]);
  const plan = useMemo(
    () => (parsed ? planImport(parsed.entries, entries, touches) : null),
    [parsed, entries, touches],
  );

  async function run() {
    const sb = getSupabase();
    if (!sb || !plan) return;
    setSaving(true);
    setError("");
    const ids = new Map(entries.map((e) => [nameKey(e.business), e.id]));
    if (plan.add.length) {
      const { data, error: e } = await sb
        .from("private_list_entries")
        .insert(
          plan.add.map((a, i) => ({
            list_id: listId,
            business: a.business,
            contact: a.contact,
            phone: a.phone,
            email: a.email,
            website: a.website,
            area: a.area,
            grp: a.grp,
            notes: a.notes,
            status: importStatus(a),
            position: entries.length + i,
          })),
        )
        .select("id,business");
      if (e || !data) {
        setSaving(false);
        setError("Couldn't import. Nothing was added. Refresh and try again.");
        return;
      }
      for (const r of data) ids.set(nameKey(r.business), r.id);
    }
    for (const u of plan.update) {
      const { error: e } = await sb.from("private_list_entries").update(u.fields).eq("id", u.id);
      if (e) {
        setSaving(false);
        setError(`Stopped at ${u.business}: couldn't update it. The rows before it are saved.`);
        return;
      }
    }
    const log = plan.log.flatMap((l) => {
      const entry_id = ids.get(nameKey(l.business));
      return entry_id
        ? [
            {
              entry_id,
              kind: "email" as const,
              happened_at: l.at,
              detail: l.subject,
              to_address: l.to,
            },
          ]
        : [];
    });
    if (log.length) {
      const { error: e } = await sb.from("private_list_touches").insert(log);
      if (e) {
        setSaving(false);
        setError(
          "The businesses are in, but the log lines couldn't be saved. Import again to add them.",
        );
        return;
      }
    }
    setSaving(false);
    onDone();
  }

  const nothing = plan && !plan.add.length && !plan.update.length && !plan.log.length;
  return (
    <div className={cn(card, "mt-6 p-4")} data-my-lists-import>
      <h4 className="font-display text-base font-bold">Import a CSV</h4>
      <p className="mt-1 text-sm text-smoke">
        The first row names the columns. Only <b>business</b> is required; contact, phone, email,
        website, area, group, notes, status, emailed_at, emailed_to and emailed_subject are read
        when present.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        className="mt-3 block text-sm"
        aria-label="CSV file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setError("");
          setText(f ? await f.text() : "");
        }}
      />
      {parsed && plan && (
        <div className="mt-3 text-sm" data-my-lists-import-plan>
          <p>
            {plan.add.length} to add · {plan.update.length} to update · {plan.log.length} sent email
            {plan.log.length === 1 ? "" : "s"} to log
          </p>
          {parsed.problems.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-destructive">
              {parsed.problems.slice(0, 8).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <button
        type="button"
        className={cn(btnPrimary, "mt-4")}
        disabled={saving || !plan || !!nothing}
        onClick={() => void run()}
      >
        {saving ? "Importing…" : "Import"}
      </button>
    </div>
  );
}

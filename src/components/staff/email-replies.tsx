import { useEffect, useState } from "react";
import { Loader2, Phone } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { card } from "@/components/site/layout";
import { chip } from "@/components/staff/field-styles";
import { ENGINE_STATUS_LABEL, ENGINE_STATUSES, tel, type EngineStatus } from "@/lib/engine-leads";
import { REPLY_SOURCE, replyRecords } from "@/lib/email-replies";

type Row = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  reason: string | null;
  signals: unknown;
  status: string;
  rep_slug: string | null;
  pushed_at: string;
};

/**
 * Email replies: everyone who answered one of Lamp's outreach emails, newest first, with their own
 * words. A rep sees the replies to the emails they sent; an admin sees every reply, so nothing the
 * sender misses goes unseen. The status is the same one Engine leads uses, so working a reply here
 * and there is the same thing. The War Room engine adds the rows (/api/engine/reply); nothing here
 * sends email.
 */
export function EmailReplies({
  isAdmin,
  reps,
}: {
  isAdmin: boolean;
  reps: { slug: string; name: string }[];
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    void (async () => {
      const { data, error: err } = await sb
        .from("engine_leads")
        .select("id,name,email,phone,city,state,reason,signals,status,rep_slug,pushed_at")
        .eq("source", REPLY_SOURCE)
        .order("pushed_at", { ascending: false })
        .limit(200);
      if (!live) return;
      if (err) setError(`Couldn't load the replies: ${err.message}`);
      else setRows((data ?? []) as Row[]);
    })();
    return () => {
      live = false;
    };
  }, []);

  async function setStatus(row: Row, next: EngineStatus) {
    const sb = getSupabase();
    if (!sb) return;
    setSaving(row.id);
    const { error: err } = await sb.from("engine_leads").update({ status: next }).eq("id", row.id);
    setSaving(null);
    if (err) return setError(`Couldn't save ${row.name ?? "that reply"}: ${err.message}`);
    setRows((rs) => (rs ? rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)) : rs));
  }

  const repName = (slug: string | null) =>
    reps.find((r) => r.slug === slug)?.name ?? (slug ? slug : "Unassigned");

  return (
    <section className="mt-6" data-email-replies>
      <h2 className="text-lg font-semibold text-ink">Email replies</h2>
      <p className="mt-1 max-w-2xl text-sm text-smoke">
        People who answered a Lamp email, newest first.{" "}
        {isAdmin
          ? "You see every reply: the rep who sent the email works it, and admins catch whatever they miss."
          : "These are the replies to the emails you sent. Your admins see them too."}
      </p>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {rows === null && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-smoke">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading replies…
        </p>
      )}
      {rows && rows.length === 0 && <p className="mt-6 text-sm text-smoke">No replies yet.</p>}
      <ul className="mt-4 grid gap-3">
        {(rows ?? []).map((r) => {
          const said = replyRecords(r.signals);
          const optout = said.some((s) => s.kind === "optout");
          return (
            <li key={r.id} className={cn(card, "p-4")} data-reply={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {r.name ?? r.email ?? "Unknown business"}
                    {optout && (
                      <span className={cn(chip, "ml-2 align-middle")}>Asked to stop emails</span>
                    )}
                  </p>
                  <p className="text-xs text-smoke">
                    {[
                      repName(r.rep_slug),
                      [r.city, r.state].filter(Boolean).join(", "),
                      `${age(r.pushed_at)} ago`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-smoke">
                  Status
                  <select
                    className="rounded-full bg-white px-3 py-1 text-sm ring-1 ring-line"
                    value={r.status}
                    disabled={saving === r.id}
                    onChange={(e) => void setStatus(r, e.target.value as EngineStatus)}
                    aria-label={`Status of ${r.name ?? "this reply"}`}
                  >
                    {ENGINE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {ENGINE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {said.map((s, i) => (
                <blockquote key={i} className="mt-3 border-l-2 border-line pl-3 text-sm text-ink">
                  {s.detail}
                  {s.date && <span className="block text-xs text-smoke">{s.date}</span>}
                </blockquote>
              ))}
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {r.phone && (
                  <a
                    className="inline-flex items-center gap-1 font-semibold text-ink underline"
                    href={`tel:${tel(r.phone)}`}
                  >
                    <Phone className="h-3.5 w-3.5" /> {r.phone}
                  </a>
                )}
                {r.email && <span className="text-smoke">{r.email}</span>}
                {r.reason && <span className="text-smoke">{r.reason}</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

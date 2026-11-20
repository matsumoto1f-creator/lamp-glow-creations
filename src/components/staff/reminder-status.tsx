import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { stamp } from "@/lib/staff";
import { reminderLine, reminderPlan } from "@/lib/finish-reminders";

/**
 * The "finish your application" reminders for one person who started and hasn't signed: what went
 * out, what's next, and a Stop reminders button (a rep for their own people, an admin for anyone,
 * e.g. when someone replies "stop"). The rules are finish-reminders.ts; the sending is the site's.
 */
export function ReminderStatus({
  kind,
  id,
  leftAt,
  sent,
  remindedAt,
  stoppedAt,
}: {
  kind: "lead" | "invite";
  id: string;
  /** When they last did something. */
  leftAt: Date;
  sent: number;
  remindedAt: string | null;
  stoppedAt: string | null;
}) {
  const [stopped, setStopped] = useState<string | null>(stoppedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastAt = remindedAt ? new Date(remindedAt) : null;
  const plan = reminderPlan(
    { leftAt, sent, lastAt, stoppedAt: stopped ? new Date(stopped) : null },
    new Date(),
  );

  async function stop() {
    setBusy(true);
    setError("");
    try {
      const sb = getSupabase();
      const session = sb ? (await sb.auth.getSession()).data.session : null;
      if (!session) throw new Error("Sign in again.");
      const res = await fetch("/api/application/reminders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "stop", kind, id }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; stopped_at?: string };
      if (!res.ok) throw new Error(j.error ?? "Couldn't stop the reminders.");
      setStopped(j.stopped_at ?? new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't stop the reminders.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <p
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-smoke"
      data-reminders={plan.kind}
    >
      <span>{reminderLine(plan, sent, lastAt, (d) => stamp(d.toISOString()))}</span>
      {plan.kind === "next" && (
        <button
          type="button"
          onClick={() => void stop()}
          disabled={busy}
          className="inline-flex min-h-8 items-center gap-1.5 font-semibold text-forest underline underline-offset-4 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
          Stop reminders
        </button>
      )}
      {error && (
        <span className="text-destructive" role="alert">
          {error}
        </span>
      )}
    </p>
  );
}

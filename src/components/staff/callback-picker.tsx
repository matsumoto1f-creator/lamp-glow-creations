import { useEffect, useState } from "react";
import { CalendarClock, Check, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnPrimary, card } from "@/components/site/layout";
import { callbackParts, nyDay, sayCallback } from "@/lib/calendar";

import { callbackChoice } from "@/lib/callback-choice";

/**
 * On an opened lead set to Callback: the day and time to call back (Asad, 2026-11-24). Saved on
 * the lead (engine_leads.callback_at); the calendar puts the "Call back ..." item at that time.
 * It reads and writes as the signed-in person, under the same row rules as status and notes.
 * Before the column is added in the database this shows nothing, and the lead works as before.
 */
export function CallbackPicker({ leadId }: { leadId: number }) {
  // undefined: still reading. null: the column isn't there yet (or the read failed).
  const [saved, setSaved] = useState<{ at: string | null } | null | undefined>(undefined);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return undefined;
    let live = true;
    void (async () => {
      const r = await sb
        .from("engine_leads")
        .select("callback_at" as never)
        .eq("id", leadId)
        .maybeSingle();
      if (!live) return;
      if (r.error || !r.data) return setSaved(null);
      const at = (r.data as unknown as { callback_at: string | null }).callback_at;
      setSaved({ at });
      const p = callbackParts(at);
      setDay(p.day);
      setTime(p.time);
    })();
    return () => {
      live = false;
    };
  }, [leadId]);

  if (!saved) return null;
  const today = nyDay(Date.now());
  const choice = callbackChoice(day, time, saved.at, today);

  async function save() {
    const sb = getSupabase();
    if (!sb || busy || !choice.at) return;
    setBusy(true);
    setError("");
    // the row comes back from the database: the line below shows what was saved, not what was asked
    const r = await sb
      .from("engine_leads")
      .update({ callback_at: choice.at } as never)
      .eq("id", leadId)
      .select("callback_at" as never)
      .maybeSingle();
    setBusy(false);
    if (r.error || !r.data) {
      setError(r.error?.message || "Not saved: this lead isn't yours to change.");
      return;
    }
    setSaved({ at: (r.data as unknown as { callback_at: string | null }).callback_at });
  }
  return (
    <CallbackPickerView
      savedAt={saved.at}
      day={day}
      time={time}
      today={today}
      busy={busy}
      error={error}
      onDay={setDay}
      onTime={setTime}
      onSave={() => void save()}
    />
  );
}

/** The picker as a plain view: everything it shows comes in as props. */
export function CallbackPickerView({
  savedAt,
  day,
  time,
  today,
  busy,
  error,
  onDay,
  onTime,
  onSave,
}: {
  /** what the lead holds now */
  savedAt: string | null;
  day: string;
  time: string;
  /** today's New York day, the earliest day that can be picked */
  today: string;
  busy: boolean;
  error: string;
  onDay: (d: string) => void;
  onTime: (t: string) => void;
  onSave: () => void;
}) {
  const choice = callbackChoice(day, time, savedAt, today);
  const box = "min-h-11 rounded-full bg-white px-4 text-base text-ink ring-1 ring-line md:text-sm";
  return (
    <section className={cn(card, "mt-4 p-4")} data-callback-picker aria-label="When to call back">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4" aria-hidden /> When to call back
      </h3>
      <p className="mt-1 text-sm text-smoke" data-callback-saved>
        {savedAt
          ? `On your calendar for ${sayCallback(savedAt)}.`
          : "No day picked yet. Until you pick one, it sits on the next business day."}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-smoke">
          <span className="mb-1 block">Day</span>
          <input
            type="date"
            className={box}
            value={day}
            min={today}
            onChange={(e) => onDay(e.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-smoke">
          <span className="mb-1 block">Time (New York), optional</span>
          <input
            type="time"
            className={box}
            value={time}
            step={300}
            onChange={(e) => onTime(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={cn(btnPrimary, "min-h-11 px-5 py-2 aria-disabled:opacity-50")}
          aria-disabled={!choice.at || busy}
          aria-busy={busy}
          onClick={() => {
            if (choice.at && !busy) onSave();
          }}
          data-callback-save
        >
          {busy ? (
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          {savedAt ? "Change callback" : "Set callback"}
        </button>
      </div>
      {(error || choice.problem) && (
        <p
          className={cn(
            "mt-2 text-sm",
            error ? "rounded-xl bg-red-100 px-3 py-2 text-red-900" : "text-smoke",
          )}
          role={error ? "alert" : undefined}
          data-callback-problem
        >
          {error || choice.problem}
        </p>
      )}
    </section>
  );
}

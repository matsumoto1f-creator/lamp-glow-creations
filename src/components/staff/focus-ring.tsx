import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  countToday,
  DAILY_TARGET,
  dayStart,
  LEAD_WORKED_EVENT,
  ringFill,
  ringLine,
  type DayCount,
  type WorkedLead,
} from "@/lib/focus";

const R = 19;
const LEN = 2 * Math.PI * R;
const REFRESH_MS = 60_000;

/**
 * The daily ring (src/lib/focus.ts): today's live conversations out of 20, on every staff page
 * beside the bell. It fills as the rep works their leads, ticks once when the number goes up, and
 * opens to say what counts and how many calls are one note away from counting. It reads the rep's
 * own leads; nothing is stored for it.
 */
export function FocusRing({ repSlug }: { repSlug: string }) {
  const [count, setCount] = useState<DayCount | null>(null);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(false);
  const last = useRef<number | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const now = new Date();
    const { data, error } = await sb
      .from("engine_leads")
      .select("status,notes,worked_at")
      .eq("rep_slug", repSlug)
      .gte("worked_at", dayStart(now).toISOString());
    if (error) return; // keep what it had; the next look tries again
    setCount(countToday((data ?? []) as WorkedLead[], now));
  }, [repSlug]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onWorked = () => void load();
    window.addEventListener(LEAD_WORKED_EVENT, onWorked);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(LEAD_WORKED_EVENT, onWorked);
    };
  }, [load]);

  // one short tick when the number goes up (never on the first load)
  const n = count?.conversations ?? null;
  useEffect(() => {
    if (n === null) return undefined;
    const wentUp = last.current !== null && n > last.current;
    last.current = n;
    if (!wentUp) return undefined;
    setTick(true);
    const t = window.setTimeout(() => setTick(false), 700);
    return () => window.clearTimeout(t);
  }, [n]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!count) return null;
  const done = count.conversations >= DAILY_TARGET;
  const fill = ringFill(count.conversations);

  return (
    <div ref={box} className="relative" data-focus-ring={count.conversations}>
      <button
        type="button"
        className={cn(
          "relative grid size-12 place-items-center rounded-full motion-safe:transition-transform motion-safe:duration-300",
          tick && "motion-safe:scale-110",
        )}
        aria-label={`${count.conversations} of ${DAILY_TARGET} live conversations today`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-focus-ring-button
      >
        <svg viewBox="0 0 44 44" className="absolute inset-0 size-12 -rotate-90" aria-hidden>
          <circle cx="22" cy="22" r={R} fill="none" strokeWidth="3.5" className="stroke-line" />
          <circle
            cx="22"
            cy="22"
            r={R}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={LEN}
            strokeDashoffset={LEN * (1 - fill)}
            className="stroke-leaf motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500"
          />
        </svg>
        <span className={cn("text-sm font-bold tabular-nums", done && "text-forest")}>
          {count.conversations}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-14 z-30 w-72 rounded-2xl border border-line bg-night p-4 text-sm shadow-xl"
          role="dialog"
          aria-label="Today's conversations"
          data-focus-ring-panel
        >
          <p className="font-display text-base font-semibold">
            {count.conversations} of {DAILY_TARGET} live conversations today
          </p>
          <p className="mt-0.5 text-smoke">{ringLine(count.conversations)}</p>
          {count.missingNote > 0 && (
            <p className="mt-3 rounded-xl bg-leaf/10 px-3 py-2" data-focus-ring-missing>
              {count.missingNote === 1
                ? "1 call today has no note yet. Add one and it counts."
                : `${count.missingNote} calls today have no note yet. Add one to each and they count.`}
            </p>
          )}
          <p className="mt-3 text-xs text-smoke">
            What counts: an engine lead you spoke to today (any status except New and No answer)
            with a note on it. Not a fit and Do not call count too. Dials don&apos;t.
          </p>
        </div>
      )}
    </div>
  );
}

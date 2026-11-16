import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, Mail, RefreshCw } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";
import { chip } from "@/components/staff/field-styles";
import {
  dayLine,
  engineTime,
  freshness,
  INDUSTRY_LABEL,
  jobState,
  mailboxDay,
  runState,
  windowWords,
  type Snapshot,
} from "@/lib/engine-status";
import type { EngineStatus as Data } from "@/lib/engine-status.server";

/**
 * Email engine (admins only): the War Room email autopilot as it runs. Its scheduled jobs (when
 * each runs next, what its last run did), each Lamp mailbox against its daily cap, today's numbers,
 * the sending queue, and whatever is holding it back. The engine posts this after every run
 * (/api/engine/status); this page only reads it and changes nothing. In review mode the day's
 * emails wait for an admin in the card above this one; in draft mode they are Gmail drafts in each
 * rep's own mailbox. The page names the day it is talking about and says in words what went out,
 * what waits and when the next emails are written (2026-11-16: "Drafting" and a bar explained nothing).
 */
async function load(): Promise<Data> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const r = await fetch("/api/engine/status", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const j = (await r.json().catch(() => ({}))) as Data & { error?: string };
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}

// the engine's times are New York clock time with no zone: shown as such, whatever the viewer's zone
const at = (naive: string) => engineTime(naive, new Date());
// the server's receipt time is a real timestamp: shown in the viewer's own zone
const local = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const TONE = {
  ok: "bg-leaf/20 text-forest",
  warn: "bg-sand text-ink",
  bad: "bg-red-100 text-red-800",
  idle: "bg-sand text-smoke",
} as const;
const STEP_TITLE: Record<string, string> = {
  research: "Lead researcher",
  morning: "Email drafter",
  replies: "Reply checker",
  send: "Email sender",
};

function Num({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className={cn(card, "p-4")}>
      <p className="text-xs text-smoke">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-smoke">{note}</p>}
    </div>
  );
}

export function EngineStatusView({ s, now = new Date() }: { s: Snapshot; now?: Date }) {
  const day = dayLine(s, now);
  const review = s.delivery === "review";
  const hours = windowWords(s.window);
  const waitingNow = s.senders.reduce((n, m) => n + (m.waiting ?? 0), 0);
  return (
    <>
      <div className={cn(card, "mt-4 p-4")} data-engine-day={day.tone}>
        <p className="font-semibold">{day.today}</p>
        {day.next && <p className="mt-1 text-sm text-smoke">{day.next}</p>}
      </div>
      <div className={cn(card, "mt-3 flex flex-wrap items-center gap-3 p-4")} data-engine-switch>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            s.autopilot_on ? TONE.ok : TONE.warn,
          )}
        >
          {s.autopilot_on ? "Autopilot on" : "Autopilot paused"}
        </span>
        <p className="text-sm text-smoke">
          {s.delivery === "draft"
            ? "Every email is written as a Gmail draft in the rep's own mailbox. The rep presses Send; the engine never emails a business by itself."
            : s.delivery === "send"
              ? "The engine sends the emails itself."
              : review
                ? `How a day goes: each weekday morning the engine writes the day's emails and they wait at the top of this page. Nothing is sent until an admin presses Send. Approved emails then go out within a few minutes${hours ? `, ${hours}` : ""}, each from its own person's mailbox.`
                : ""}{" "}
          {s.daily_cap !== null && `At most ${s.daily_cap} a day in all. `}
          {s.senders.some((m) => m.ramp) &&
            "New mailboxes warm up first: a few a day, rising to their full cap as they really send. "}
          {s.reply_check.ran_at &&
            `Replies last checked ${at(s.reply_check.ran_at)}${s.reply_check.ok ? "" : " (that check failed)"}.`}
        </p>
      </div>

      {s.blocked.length > 0 && (
        <div className="mt-4 rounded-2xl bg-sand p-4" role="status" data-engine-blocked>
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" /> Holding it back
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {s.blocked.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mt-6 flex items-center gap-2 font-display text-base font-semibold">
        <CalendarClock className="size-4 text-forest" /> The schedule
      </h3>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        {s.jobs.map((j) => {
          const st = jobState(j);
          return (
            <div key={j.label} className={cn(card, "p-5")} data-engine-job={j.step}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display font-semibold">{j.title}</h4>
                <span
                  className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[st.tone])}
                >
                  {st.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-smoke">{j.what}</p>
              <p className="mt-3 text-sm">
                <span className="font-semibold">{j.schedule}</span>
                {j.next_run && (
                  <span className="text-smoke">
                    {" "}
                    · next {at(j.next_run)}
                    {runState(j.next_run, new Date()) === "running" &&
                      " (running now, or about to report)"}
                    {runState(j.next_run, new Date()) === "overdue" &&
                      " (overdue: the Mac may have been asleep or off)"}
                  </span>
                )}
              </p>
              {j.last && (
                <p className="mt-2 text-sm">
                  <span className="text-smoke">Last run {at(j.last.started_at)}: </span>
                  {j.last.summary}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <h3 className="mt-6 flex items-center gap-2 font-display text-base font-semibold">
        <Mail className="size-4 text-forest" /> Mailboxes
      </h3>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {s.senders.map((m) => {
          const d = mailboxDay(m, s, now);
          // the bar: sent is the bright part, waiting the pale part, the rest of today's limit the track.
          // The fill was bg-forest on bg-sand, which on the dark page are nearly one colour: a full bar looked empty.
          const of = Math.max(m.cap, d.sent + d.waiting, 1);
          const sentPct = Math.round((d.sent / of) * 100);
          const waitPct = Math.min(100 - sentPct, Math.round((d.waiting / of) * 100));
          return (
            <div key={m.key} className={cn(card, "p-4")} data-engine-mailbox={m.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{m.name}</p>
                <span
                  className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[d.tone])}
                  data-engine-mailbox-pill
                >
                  {d.pill}
                </span>
              </div>
              <p className="text-xs text-smoke">{m.mailbox}</p>
              {m.state !== "off" && (
                <>
                  <div
                    className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-line"
                    aria-hidden
                    data-engine-bar
                  >
                    <div className="h-full bg-leaf" style={{ width: `${sentPct}%` }} />
                    <div className="h-full bg-leaf/40" style={{ width: `${waitPct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-smoke">
                    {d.sent} sent{d.waiting > 0 ? `, ${d.waiting} waiting` : ""} · today's limit{" "}
                    {m.cap}
                  </p>
                </>
              )}
              <p className="mt-2 text-sm" data-engine-mailbox-today>
                {d.today}
              </p>
              {d.next && (
                <p className="mt-1 text-sm text-smoke" data-engine-mailbox-next>
                  {d.next}
                </p>
              )}
              {m.on && m.ramp && m.ramp.limiting && (
                <p
                  className={cn(
                    "mt-2 rounded-md px-2 py-1 text-xs",
                    m.ramp.held || m.ramp.restarted ? TONE.warn : TONE.idle,
                  )}
                  data-engine-ramp={m.key}
                >
                  {m.ramp.words}
                </p>
              )}
              {m.on && m.why && <p className="mt-2 text-sm">{m.why}</p>}
            </div>
          );
        })}
      </div>

      <h3 className="mt-6 font-display text-base font-semibold">Today</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {review ? (
          <Num
            label="Waiting for your approval"
            value={waitingNow}
            note={waitingNow ? "at the top of this page" : "nothing is waiting on you"}
          />
        ) : (
          <Num label="First emails drafted" value={s.today.first_emails_drafted} />
        )}
        <Num label="First emails sent" value={s.today.first_emails_sent} />
        <Num
          label={review ? "Follow-ups written" : "Follow-ups drafted"}
          value={s.today.followups_drafted}
        />
        <Num label="Replies" value={s.today.replies} />
      </div>
      <h3 className="mt-6 font-display text-base font-semibold">So far</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {review ? (
          <Num label="Follow-ups sent" value={s.totals.followups_sent} />
        ) : (
          <Num
            label="Waiting in Drafts"
            value={s.totals.waiting_in_drafts}
            note="written, not sent yet"
          />
        )}
        <Num label="First emails sent" value={s.totals.first_emails_sent} />
        <Num label="Businesses that replied" value={s.totals.replied} />
        <Num
          label="Bounce rate"
          value={`${(s.totals.bounce_rate * 100).toFixed(1)}%`}
          note={`${s.totals.bounced} bounced${
            s.kill.max_bounce_rate !== null
              ? ` · every send stops above ${Math.round(s.kill.max_bounce_rate * 100)}%${s.kill.min_sends ? ` once ${s.kill.min_sends} have gone out` : ""}`
              : ""
          }`}
        />
      </div>

      <h3 className="mt-6 font-display text-base font-semibold">The sending queue</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Num label="In the queue" value={s.queue.ranked} />
        <Num label="Emailed" value={s.queue.emailed} />
        <Num
          label="Researched, waiting"
          value={s.queue.researched_waiting}
          note={`of ${s.queue.waiting} waiting`}
        />
        <Num
          label="With a line about them"
          value={s.queue.personal_lines_waiting}
          note="a fact from their own website"
        />
      </div>
      {s.queue.industries.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" data-engine-industries>
          {s.queue.industries.map((x) => (
            <span key={x.key} className={cn(chip, "gap-1")}>
              {INDUSTRY_LABEL[x.key] ?? x.key}
              <span className="tabular-nums text-smoke">{x.count}</span>
            </span>
          ))}
        </div>
      )}

      {s.recent.length > 0 && (
        <>
          <h3 className="mt-6 font-display text-base font-semibold">Latest runs</h3>
          <ul className="mt-3 grid gap-2" data-engine-recent>
            {s.recent.map((r, i) => (
              <li
                key={`${r.at}-${i}`}
                className={cn(card, "flex flex-wrap gap-x-3 gap-y-1 p-3 text-sm")}
              >
                <span className="text-smoke tabular-nums">{at(r.at)}</span>
                <span className="font-semibold">{STEP_TITLE[r.step] ?? r.step}</span>
                {!r.ok && <span className={cn("rounded-full px-2 text-xs", TONE.bad)}>Failed</span>}
                <span className="min-w-0 basis-full md:basis-auto">{r.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {s.lists.length > 0 && (
        <>
          <h3 className="mt-6 font-display text-base font-semibold">Lead lists</h3>
          <p className="mt-1 text-sm text-smoke">
            Which lists the engine draws from. Asad switches them.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {s.lists.map((l) => (
              <span
                key={l.name}
                className={cn(chip, l.mode === "off" && "opacity-50 line-through")}
              >
                {l.label}
                {l.daily_cap !== null ? ` · ${l.daily_cap}/day` : ""}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function EngineStatus() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await load());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the email engine.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const s = data?.snapshot ?? null;
  const fresh = s ? freshness(data?.received_at ?? null, new Date()) : null;

  return (
    <section className="mt-6" data-engine-status>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Email engine</h2>
          <p className="mt-1 max-w-2xl text-sm text-smoke">
            The email autopilot as it runs: its schedule, what each run did, each mailbox against
            its daily cap, and anything holding it back.
            {s && data?.received_at && ` Updated ${local(data.received_at)}.`}
          </p>
        </div>
        <button
          type="button"
          className={cn(chip, "min-h-11 gap-2 px-4")}
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-smoke">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}
      {data && !s && (
        <p className="mt-6 text-sm text-smoke">
          The engine has not reported yet. It reports after every scheduled run.
        </p>
      )}
      {fresh && fresh !== "fresh" && (
        <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-sm" role="alert" data-engine-stale>
          The engine last reported {data?.received_at ? local(data.received_at) : "a while ago"}. It
          reports at least every weekday morning, so its computer may be off or its jobs stopped.
          The numbers below are from then.
        </p>
      )}
      {s && <EngineStatusView s={s} />}
    </section>
  );
}

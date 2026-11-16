// Email engine status (2026-11-12): the War Room email autopilot (outreach/emailkit/autopilot.py)
// posts a snapshot of itself after every scheduled run to /api/engine/status, with the same shared
// secret as the daily lead push and the reply check. Admins see it in Staff > Email engine: each
// scheduled job (when it runs, when it last ran, what it did), each Lamp mailbox against its daily
// cap, today's numbers, the sending queue, and whatever is holding the engine back. It holds counts,
// job names and business-free summaries only: no email text, no addresses of businesses, no secret.
// This file is the part with no server or database in it, so the tests can load it.

/** The one snapshot key the engine writes today (one row per engine). */
export const STATUS_KEYS = ["lamp-email"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export type JobLast = { started_at: string; ended_at: string; ok: boolean; summary: string };
export type Job = {
  label: string;
  step: string;
  title: string;
  what: string;
  schedule: string;
  next_run: string;
  state: "on" | "paused" | "off";
  last: JobLast | null;
};
export type Mailbox = {
  key: string;
  name: string;
  mailbox: string;
  on: boolean;
  connected: boolean;
  cap: number;
  used: number;
  why: string;
  /** drafting: on autopilot and nothing holds it; held: its own reason or a lane-wide gate (sign-off, pause...); off: not on autopilot */
  state: "drafting" | "held" | "off";
  /** The mailbox's warm-up ramp (2026-11-12), or null when the engine runs without one. */
  ramp: Ramp | null;
  /** Emails this mailbox really sent today (2026-11-16); null from an engine that does not report it yet. */
  sent_today: number | null;
  /** Emails written from this mailbox and not sent yet: waiting for approval, or in Drafts. Null as above. */
  waiting: number | null;
  /** Approved and going out later today (held for sending hours or the business's own morning); null as above. */
  scheduled: number | null;
  /** When the last of those goes, as New York clock text, or "". */
  scheduled_last: string;
};
/**
 * A new mailbox earns its daily cap by really sending: 5 a day at first, 10 from sending day 6, 20 from
 * day 11, 30 from day 16 (the steps live in the engine's offer.json). `day` is today's sending day;
 * `limiting` is true when the ramp, not the mailbox's own cap, is what holds it today; `held` means
 * recent bounces put it a step back; `restarted` means it went quiet long enough to start over.
 */
export type Ramp = {
  day: number;
  cap: number;
  next_cap: number | null;
  next_day: number | null;
  limiting: boolean;
  held: boolean;
  restarted: boolean;
  words: string;
};
export type Snapshot = {
  key: StatusKey;
  built_at: string;
  autopilot_on: boolean;
  delivery: string;
  /** The sending hours as the engine holds them, "Mon-Fri 09:00-17:00 America/New_York", or "". */
  window: string;
  /** "09:30" when approved emails wait until that time of day where the business is; "" when they do not. */
  local_not_before: string;
  daily_cap: number | null;
  senders: Mailbox[];
  jobs: Job[];
  today: {
    first_emails_drafted: number;
    first_emails_sent: number;
    followups_drafted: number;
    replies: number;
  };
  totals: {
    first_emails_drafted: number;
    first_emails_sent: number;
    waiting_in_drafts: number;
    replied: number;
    bounced: number;
    bounce_rate: number;
    followups_sent: number;
  };
  queue: {
    ranked: number;
    emailed: number;
    waiting: number;
    researched_waiting: number;
    personal_lines_waiting: number;
    industries: { key: string; count: number }[];
  };
  blocked: string[];
  lists: { name: string; label: string; mode: string; daily_cap: number | null }[];
  recent: { at: string; step: string; ok: boolean; summary: string }[];
  reply_check: { ran_at: string; ok: boolean; portal_waiting: number };
  /** the bounce kill switch as the engine applies it: stops above max_bounce_rate once min_sends first emails went out */
  kill: { max_bounce_rate: number | null; min_sends: number | null };
};

/** The largest snapshot the portal stores, as JSON text. */
export const MAX_BYTES = 64_000;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const txt = (v: unknown, max = 300): string =>
  typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "";
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e9) : 0;
};
const bool = (v: unknown) => v === true;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const when = (v: unknown) => {
  const s = txt(v, 25);
  return DATE.test(s) ? s : "";
};

const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
function parseRamp(v: unknown): Ramp | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Raw;
  return {
    day: num(r["day"]),
    cap: num(r["cap"]),
    next_cap: maybe(r["next_cap"]),
    next_day: maybe(r["next_day"]),
    limiting: bool(r["limiting"]),
    held: bool(r["held"]),
    restarted: bool(r["restarted"]),
    words: txt(r["words"], 300),
  };
}

/**
 * Checks and copies the posted snapshot, keeping only the fields the page shows, each cut to size.
 * Refused whole (with the reason) when it is not { snapshot: {...} }, names an unknown key, has no
 * time it was built, or is too big. Unknown fields are dropped, never stored.
 */
export function parseStatus(body: unknown): { snapshot: Snapshot } | { problem: string } {
  const s = obj(obj(body)["snapshot"]);
  if (!Object.keys(s).length) return { problem: "Send { snapshot: {...} }." };
  const key = txt(s["key"], 40) as StatusKey;
  if (!STATUS_KEYS.includes(key))
    return { problem: `key should be one of ${STATUS_KEYS.join(", ")}.` };
  const built = when(s["built_at"]);
  if (!built) return { problem: "built_at should be a time like 2026-11-12T08:31:00." };
  if (JSON.stringify(body).length > MAX_BYTES * 4) return { problem: "The snapshot is too big." };
  const kill = obj(s["kill"]);
  const t = obj(s["today"]),
    tot = obj(s["totals"]),
    q = obj(s["queue"]),
    rc = obj(s["reply_check"]);
  const state = (v: unknown): Job["state"] => (v === "on" || v === "paused" ? v : "off");
  const snap: Snapshot = {
    key,
    built_at: built,
    autopilot_on: bool(s["autopilot_on"]),
    delivery: txt(s["delivery"], 20),
    window: txt(s["window"], 80),
    local_not_before: /^\d\d:\d\d$/.test(txt(s["local_not_before"], 5))
      ? txt(s["local_not_before"], 5)
      : "",
    daily_cap: s["daily_cap"] === null || s["daily_cap"] === undefined ? null : num(s["daily_cap"]),
    senders: arr(s["senders"], 10).map((x) => {
      const m = obj(x);
      return {
        key: txt(m["key"], 40),
        name: txt(m["name"], 80),
        mailbox: txt(m["mailbox"], 120),
        on: bool(m["on"]),
        connected: bool(m["connected"]),
        cap: num(m["cap"]),
        used: num(m["used"]),
        why: txt(m["why"]),
        ramp: parseRamp(m["ramp"]),
        sent_today: maybe(m["sent_today"]),
        waiting: maybe(m["waiting"]),
        scheduled: maybe(m["scheduled"]),
        scheduled_last: when(m["scheduled_last"]),
        state:
          m["state"] === "drafting" || m["state"] === "held"
            ? m["state"]
            : bool(m["on"])
              ? "held"
              : "off",
      };
    }),
    jobs: arr(s["jobs"], 10).map((x) => {
      const j = obj(x);
      const l = j["last"] ? obj(j["last"]) : null;
      return {
        label: txt(j["label"], 80),
        step: txt(j["step"], 20),
        title: txt(j["title"], 60),
        what: txt(j["what"]),
        schedule: txt(j["schedule"], 120),
        next_run: when(j["next_run"]),
        state: state(j["state"]),
        last: l
          ? {
              started_at: when(l["started_at"]),
              ended_at: when(l["ended_at"]),
              ok: bool(l["ok"]),
              summary: txt(l["summary"], 600),
            }
          : null,
      };
    }),
    today: {
      first_emails_drafted: num(t["first_emails_drafted"]),
      first_emails_sent: num(t["first_emails_sent"]),
      followups_drafted: num(t["followups_drafted"]),
      replies: num(t["replies"]),
    },
    totals: {
      first_emails_drafted: num(tot["first_emails_drafted"]),
      first_emails_sent: num(tot["first_emails_sent"]),
      waiting_in_drafts: num(tot["waiting_in_drafts"]),
      replied: num(tot["replied"]),
      bounced: num(tot["bounced"]),
      bounce_rate: Math.min(num(tot["bounce_rate"]), 1),
      followups_sent: num(tot["followups_sent"]),
    },
    queue: {
      ranked: num(q["ranked"]),
      emailed: num(q["emailed"]),
      waiting: num(q["waiting"]),
      researched_waiting: num(q["researched_waiting"]),
      personal_lines_waiting: num(q["personal_lines_waiting"]),
      industries: Object.entries(obj(q["industries"]))
        .slice(0, 30)
        .map(([k, v]) => ({ key: txt(k, 40), count: num(v) }))
        .filter((x) => x.key)
        .sort((a, b) => b.count - a.count),
    },
    blocked: arr(s["blocked"], 20)
      .map((x) => txt(x))
      .filter(Boolean),
    lists: arr(s["lists"], 40).map((x) => {
      const l = obj(x);
      return {
        name: txt(l["name"], 40),
        label: txt(l["label"], 120),
        mode: l["mode"] === "off" ? "off" : "on",
        daily_cap:
          l["daily_cap"] === null || l["daily_cap"] === undefined ? null : num(l["daily_cap"]),
      };
    }),
    recent: arr(s["recent"], 20).map((x) => {
      const r = obj(x);
      return {
        at: when(r["at"]),
        step: txt(r["step"], 20),
        ok: bool(r["ok"]),
        summary: txt(r["summary"], 600),
      };
    }),
    reply_check: {
      ran_at: when(rc["ran_at"]),
      ok: bool(rc["ok"]),
      portal_waiting: num(rc["portal_waiting"]),
    },
    kill: {
      max_bounce_rate:
        kill["max_bounce_rate"] == null ? null : Math.min(num(kill["max_bounce_rate"]), 1),
      min_sends: kill["min_sends"] == null ? null : num(kill["min_sends"]),
    },
  };
  if (JSON.stringify(snap).length > MAX_BYTES) return { problem: "The snapshot is too big." };
  return { snapshot: snap };
}

/**
 * How old the snapshot is, from the time Lamp's server RECEIVED it (a real timestamp), never from
 * the engine's own clock text. The engine reports after every run (at least each weekday morning
 * and three reply checks), so more than a day and a half without one means the engine's Mac is off
 * or the jobs stopped: the page says so instead of showing old numbers as if they were live.
 */
export function freshness(receivedAt: string | null, now: Date): "fresh" | "late" | "stale" {
  const t = receivedAt ? new Date(receivedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return "stale";
  const h = (now.getTime() - t) / 3_600_000;
  return h <= 26 ? "fresh" : h <= 72 ? "late" : "stale";
}

/** The engine runs on a Mac in New York and writes its times as New York clock time with no zone. */
export const ENGINE_ZONE = "America/New_York";
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Now as New York clock text, "YYYY-MM-DDTHH:MM", to compare with the engine's times. */
export function engineNow(now: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ENGINE_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}`;
}

/**
 * An engine time in words, read as New York time whatever the viewer's zone: "Wed 9:47 PM ET",
 * with the month and day added once it is more than six days from now ("Nov 3, 9:47 PM ET").
 * Text that is not a time comes back empty.
 */
export function engineTime(naive: string, now: Date): string {
  const m = NAIVE.exec(naive || "");
  if (!m) return "";
  const [y = 0, mo = 1, d = 1, h = 0, mi = 0] = m.slice(1).map(Number);
  const day = Date.UTC(y, mo - 1, d);
  const t = NAIVE.exec(engineNow(now))!;
  const today = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  const clock = `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
  return Math.abs(today - day) > 6 * 86_400_000
    ? `${MONTH[mo - 1]} ${d}, ${clock}`
    : `${WEEKDAY[new Date(day).getUTCDay()]} ${clock}`;
}

/**
 * Where a job's next run stands. The engine reports only when a run ENDS, so a next run that has just passed usually means the
 * job is running right now: "running" for up to 4 hours after it (the longest a run is allowed), "overdue" after that (the
 * Mac was likely asleep or off), "" when it is still ahead.
 */
export function runState(naive: string, now: Date): "" | "running" | "overdue" {
  const m = NAIVE.exec(naive || "");
  if (!m) return "";
  const n = NAIVE.exec(engineNow(now))!;
  const mins = (x: RegExpExecArray) =>
    Date.UTC(Number(x[1]), Number(x[2]) - 1, Number(x[3]), Number(x[4]), Number(x[5])) / 60_000;
  const late = mins(n) - mins(m);
  return late <= 0 ? "" : late <= 240 ? "running" : "overdue";
}

/** A job's one-line state for the page: "Off", "Paused", "Failed at …", "Ran …", "Not run yet". */
export function jobState(j: Job): { tone: "ok" | "warn" | "bad" | "idle"; label: string } {
  if (j.state === "off") return { tone: "bad", label: "Off" };
  if (j.state === "paused") return { tone: "warn", label: "Paused" };
  if (!j.last) return { tone: "idle", label: "Not run yet" };
  return j.last.ok
    ? { tone: "ok", label: "Last run worked" }
    : { tone: "bad", label: "Last run failed" };
}

/** The industry keys the engine uses, in words. */
export const INDUSTRY_LABEL: Record<string, string> = {
  construction: "Construction",
  trades: "Trades",
  trucking: "Trucking",
  auto: "Auto",
  food: "Food",
  medical: "Medical",
  wellness: "Wellness",
  retail: "Retail",
  services: "Services",
  professional: "Professional",
  property: "Property",
  manufacturing: "Manufacturing",
  other: "General wording",
};

/** "Mon Nov 16" for an engine time or day ("2026-11-16T08:30" or "2026-11-16"); "" when it is not one. */
export function engineDay(naive: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(naive || "");
  if (!m) return "";
  const [y = 0, mo = 1, d = 1] = m.slice(1).map(Number);
  return `${WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${MONTH[mo - 1]} ${d}`;
}
const clock12 = (h: number, mi: number) =>
  `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
/** "8:30 AM ET" for an engine time; "" when it is not one. */
export function engineClock(naive: string): string {
  const m = NAIVE.exec(naive || "");
  return m ? `${clock12(Number(m[4]), Number(m[5]))} ET` : "";
}
/**
 * The sending hours in words: "Mon-Fri 09:00-17:00 America/New_York" reads "Mon-Fri, 9:00 AM to 5:00 PM ET".
 * Anything in another form (or another zone) comes back as it was written, so the page never invents hours.
 */
export function windowWords(w: string): string {
  const m = /^([A-Za-z]{3}-[A-Za-z]{3}) (\d{2}):(\d{2})-(\d{2}):(\d{2}) (\S+)$/.exec(
    (w || "").trim(),
  );
  if (!m) return (w || "").trim();
  const zone = m[6] === ENGINE_ZONE ? "ET" : m[6];
  return `${m[1]}, ${clock12(Number(m[2]), Number(m[3]))} to ${clock12(Number(m[4]), Number(m[5]))} ${zone}`;
}

/** "9:30 AM" for "09:30"; "" for anything else. */
export function hourWords(hm: string): string {
  const m = /^(\d\d):(\d\d)$/.exec(hm || "");
  return m ? clock12(Number(m[1]), Number(m[2])) : "";
}
/** Approved emails that go out later today, in words: when they go, and when the last one does. */
function laterWords(n: number, last: string, s: Snapshot): string {
  const nb = hourWords(s.local_not_before);
  const when_ = nb ? `at ${nb} in each business's own time zone` : "in the next sending hours";
  return `${n} approved and going out ${when_}${last && engineClock(last) ? `, the last at ${engineClock(last)}` : ""}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The cap a mailbox will have on its next sending day: today's sends earn the next warm-up day. */
function nextCap(m: Mailbox, sentToday: number): number {
  const r = m.ramp;
  if (!r || !r.limiting || r.next_cap === null || r.next_day === null) return m.cap;
  return r.day + (sentToday > 0 ? 1 : 0) >= r.next_day ? Math.max(m.cap, r.next_cap) : m.cap;
}
/** Where the drafting job stands against today (New York): did it run today, is it still due today, and when is it next. */
function draftingDay(s: Snapshot, now: Date) {
  const today = engineNow(now).slice(0, 10);
  const job = s.jobs.find((j) => j.step === "morning") ?? null;
  const next = job && job.state === "on" ? job.next_run : "";
  return {
    today,
    ranToday: (job?.last?.started_at ?? "").slice(0, 10) === today,
    dueToday: next.slice(0, 10) === today,
    next,
  };
}
const review = (s: Snapshot) => s.delivery === "review";

/**
 * One mailbox's day in words (Asad 2026-11-16: the card said only "Drafting" and a bar that looked empty when it was full).
 * It names the day it is talking about, says what went out and what waits, and says when the next emails are written and how
 * many. `sent` and `waiting` drive the bar. Everything comes from the snapshot: a number the engine did not report is not shown.
 */
export type MailboxDay = {
  tone: "ok" | "warn" | "idle";
  pill: string;
  today: string;
  next: string;
  sent: number;
  /** approved, going out later today */
  scheduled: number;
  waiting: number;
};
export function mailboxDay(m: Mailbox, s: Snapshot, now: Date): MailboxDay {
  const d = draftingDay(s, now);
  const day = `Today, ${engineDay(d.today)}`;
  const rv = review(s);
  const sent = m.sent_today ?? 0;
  const waiting = m.waiting ?? 0;
  const scheduled = m.scheduled ?? 0;
  const base = { sent, waiting, scheduled };
  if (m.state === "off")
    return {
      ...base,
      tone: "idle",
      pill: "Not on autopilot",
      today: "The engine writes no emails from this mailbox.",
      next: "",
    };
  if (m.state === "held")
    return {
      ...base,
      tone: "warn",
      pill: "Held",
      today: `${day}: nothing is written from this mailbox until the reason below is cleared.${sent ? ` ${plural(sent, "email")} went out earlier today.` : ""}`,
      next: "",
    };
  const then = rv
    ? "wait for your approval at the top of this page"
    : "go into this mailbox's Gmail Drafts";
  const next = !s.autopilot_on
    ? "Next: nothing while autopilot is paused."
    : !d.next
      ? "Next: the drafting job is not scheduled."
      : d.dueToday
        ? ""
        : `Next: ${engineDay(d.next)} at ${engineClock(d.next)}, up to ${nextCap(m, sent)} more are written and ${then}.`;
  if (m.sent_today === null || m.waiting === null)
    return {
      ...base,
      sent: m.used,
      tone: "ok",
      pill: "On autopilot",
      today: `${day}: ${m.used} of ${m.cap} used.`,
      next,
    };
  if (scheduled > 0 && waiting === 0)
    return {
      ...base,
      tone: "ok",
      pill: "Approved, going out",
      today: `${day}: ${sent} sent, ${laterWords(scheduled, m.scheduled_last, s)}. Nothing more is needed from you.`,
      next,
    };
  if (waiting > 0)
    return {
      ...base,
      tone: "warn",
      pill: rv ? "Waiting for your approval" : "Waiting in Drafts",
      today: `${day}: ${sent} sent, ${scheduled > 0 ? `${laterWords(scheduled, m.scheduled_last, s)}, ` : ""}${waiting} waiting ${rv ? "for your approval at the top of this page" : "in Gmail Drafts for the rep to send"}.`,
      next,
    };
  if (sent > 0)
    return {
      ...base,
      tone: "ok",
      pill: "Done for today",
      today:
        sent >= m.cap
          ? `${day}: all ${sent} sent. This mailbox is finished for today.`
          : `${day}: ${sent} sent of a limit of ${m.cap}. Nothing else is waiting, so this mailbox is finished for today.`,
      next,
    };
  if (d.dueToday)
    return {
      ...base,
      tone: "idle",
      pill: "Not written yet",
      today: `${day}: nothing written yet. Up to ${m.cap} are written at ${engineClock(d.next)} and then ${then}.`,
      next,
    };
  return {
    ...base,
    tone: "idle",
    pill: "Nothing today",
    today: d.ranToday
      ? `${day}: no email was written for this mailbox. The drafting run's own words are under Latest runs.`
      : `${day}: no emails are written today.`,
    next,
  };
}

/**
 * The whole engine's day in one or two sentences, for the top of the page: what went out today across the mailboxes on
 * autopilot, what still waits on a person, and when the next emails are written.
 */
export function dayLine(
  s: Snapshot,
  now: Date,
): { tone: "ok" | "warn" | "idle"; today: string; next: string } {
  const d = draftingDay(s, now);
  const day = `Today, ${engineDay(d.today)}`;
  const on = s.senders.filter((m) => m.state === "drafting");
  const rv = review(s);
  const then = rv ? "wait for your approval at the top of this page" : "go into Gmail Drafts";
  const known = on.length > 0 && on.every((m) => m.sent_today !== null && m.waiting !== null);
  const sent = on.reduce((n, m) => n + (m.sent_today ?? 0), 0);
  const waiting = on.reduce((n, m) => n + (m.waiting ?? 0), 0);
  const scheduled = on.reduce((n, m) => n + (m.scheduled ?? 0), 0);
  const last =
    on
      .map((m) => (m.scheduled ? m.scheduled_last : ""))
      .sort()
      .pop() ?? "";
  const later = scheduled > 0 ? `${laterWords(scheduled, last, s)}` : "";
  const room = on.reduce((n, m) => n + nextCap(m, m.sent_today ?? 0), 0);
  const next = !s.autopilot_on
    ? "Autopilot is paused, so nothing more is written until it is switched back on."
    : !d.next
      ? "The drafting job is not scheduled."
      : d.dueToday
        ? `Up to ${on.reduce((n, m) => n + m.cap, 0)} are written today at ${engineClock(d.next)} and then ${then}.`
        : `Next: ${engineDay(d.next)} at ${engineClock(d.next)}, up to ${room} more are written and ${then}.`;
  if (!on.length)
    return { tone: "warn", today: `${day}: no mailbox can write emails right now.`, next: "" };
  if (!known)
    return {
      tone: "idle",
      today: `${day}: ${plural(s.today.first_emails_sent, "first email")} sent.`,
      next,
    };
  if (waiting > 0)
    return {
      tone: "warn",
      today: `${day}: ${sent} sent, ${later ? `${later}, ` : ""}${waiting} waiting ${rv ? "for your approval at the top of this page. Nothing goes out until you press Send." : "in Gmail Drafts for the reps to send."}`,
      next,
    };
  if (scheduled > 0)
    return {
      tone: "ok",
      today: `${day}: ${sent} sent, ${later}. Nothing more is needed from you.`,
      next,
    };
  if (sent > 0)
    return {
      tone: "ok",
      today: `${day}: ${plural(sent, "email")} sent, none waiting. Everything for today has gone out.`,
      next,
    };
  return {
    tone: "idle",
    today: d.dueToday
      ? `${day}: nothing written yet.`
      : d.ranToday
        ? `${day}: no emails were written. The reason is under Holding it back or Latest runs.`
        : `${day}: no emails are written today.`,
    next,
  };
}

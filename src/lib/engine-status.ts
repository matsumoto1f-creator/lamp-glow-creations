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
};
export type Snapshot = {
  key: StatusKey;
  built_at: string;
  autopilot_on: boolean;
  delivery: string;
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

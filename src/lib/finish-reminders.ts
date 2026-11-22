// "Finish your application" reminders (Asad, 2026-11-19, the funnel map he signed off): someone who
// started an application and left gets one email an hour later and one the next morning, then
// nothing. They stop as soon as the person signs, presses the stop link, or a rep presses Stop
// reminders. The rules live here so the job, the staff screens and the tests read the same ones.
// Browser-safe: no server imports.

/** Lamp is in New Jersey: quiet hours and "the next morning" are Eastern time. */
export const REMINDER_TZ = "America/New_York";
/** Never sends before 8:00 or from 21:00 Eastern; a reminder due then waits for 9:30. */
const QUIET_FROM = 21;
const QUIET_UNTIL = 8;
const MORNING = { h: 9, min: 30 };
/** A reminder more than this late is skipped, never sent: no catch-up blast after downtime. */
export const STALE_MS = 12 * 3_600_000;
export const MAX_REMINDERS = 2;

type Parts = { y: number; m: number; d: number; h: number; min: number };

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: REMINDER_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Eastern wall-clock time of an instant. */
export function easternParts(t: Date): Parts {
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
  return {
    y: Number(p["year"]),
    m: Number(p["month"]),
    d: Number(p["day"]),
    h: Number(p["hour"]) % 24,
    min: Number(p["minute"]),
  };
}

/** The instant of an Eastern wall-clock time (a day past the month's end rolls over). */
export function easternTime(y: number, m: number, d: number, h: number, min: number): Date {
  const want = Date.UTC(y, m - 1, d, h, min);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = easternParts(new Date(guess));
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    if (seen === want) break;
    guess += want - seen;
  }
  return new Date(guess);
}

/** 9:30 Eastern on the day of t, plus `days`. */
function morning(t: Date, days: number): Date {
  const p = easternParts(t);
  return easternTime(p.y, p.m, p.d + days, MORNING.h, MORNING.min);
}

/** Night in Eastern time: nothing is sent then, however late a reminder is running. */
export function quietAt(t: Date): boolean {
  const h = easternParts(t).h;
  return h < QUIET_UNTIL || h >= QUIET_FROM;
}

/** The first reminder: an hour after they left, or 9:30 if that falls in quiet hours. */
export function firstReminderAt(leftAt: Date): Date {
  const t = new Date(leftAt.getTime() + 3_600_000);
  const h = easternParts(t).h;
  if (h < QUIET_UNTIL) return morning(t, 0);
  if (h >= QUIET_FROM) return morning(t, 1);
  return t;
}

/** The second: 9:30 Eastern the morning after the first went out. */
export function secondReminderAt(firstSentAt: Date): Date {
  return morning(firstSentAt, 1);
}

export type ReminderState = {
  /** When they last did something: started, or reached a later step. */
  leftAt: Date;
  /** Reminders already sent (0, 1 or 2). */
  sent: number;
  /** When the last one went out. */
  lastAt: Date | null;
  /** A rep, or the person, said stop. */
  stoppedAt: Date | null;
};

export type ReminderPlan =
  | { kind: "next"; n: 1 | 2; at: Date; due: boolean }
  | { kind: "stopped"; at: Date }
  | { kind: "done" }
  /** Too late for one (they left long before reminders started, or the job was down). */
  | { kind: "missed" };

/** What happens next for one person, at `now`. */
export function reminderPlan(s: ReminderState, now: Date): ReminderPlan {
  if (s.stoppedAt) return { kind: "stopped", at: s.stoppedAt };
  if (s.sent >= MAX_REMINDERS) return { kind: "done" };
  const n = (s.sent + 1) as 1 | 2;
  const at = n === 1 ? firstReminderAt(s.leftAt) : secondReminderAt(s.lastAt ?? s.leftAt);
  if (now.getTime() > at.getTime() + STALE_MS)
    return n === 1 ? { kind: "missed" } : { kind: "done" };
  // a reminder running late (the job was down, or the site published at night) still waits for
  // the morning; if that makes it more than STALE_MS late, it's skipped above on a later tick
  return { kind: "next", n, at, due: now.getTime() >= at.getTime() && !quietAt(now) };
}

/** When a lead last did something: when they started, or their furthest step. */
export function leadLeftAt(createdAt: string, answers: Record<string, unknown> | null): Date {
  const p = answers?.["progress"] as { at?: unknown } | undefined;
  const at = typeof p?.at === "string" ? Date.parse(p.at) : NaN;
  const c = Date.parse(createdAt);
  return new Date(Number.isFinite(at) && at > c ? at : c);
}

/** When a personal link was last worked on: started, or its draft last saved. */
export function inviteLeftAt(startedAt: string, draftSavedAt: string | null): Date {
  const s = Date.parse(startedAt);
  const d = draftSavedAt ? Date.parse(draftSavedAt) : NaN;
  return new Date(Number.isFinite(d) && d > s ? d : s);
}

// ---------- the links in a reminder ----------

/**
 * A personal link's reminder carries its own token, so the link the rep sent is never changed:
 * "r" + the invite id (32 hex) + a signature of the id and the link's current token hash (22
 * characters). A resend gives the link a new token hash, so an old reminder's link stops working
 * with it. 55 characters, inside the application token pattern; a rep's token is 43.
 */
export const REMIND_TOKEN = /^r[0-9a-f]{32}[A-Za-z0-9_-]{22}$/;

export const inviteIdOf = (token: string): string | null => {
  if (!REMIND_TOKEN.test(token)) return null;
  const h = token.slice(1, 33);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** The stop link's token: who (l = lead, i = personal link), their id, and a signature. */
export const STOP_TOKEN = /^([li])\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

export function parseStopToken(
  t: unknown,
): { kind: "lead" | "invite"; id: string; sig: string } | null {
  const m = typeof t === "string" ? STOP_TOKEN.exec(t) : null;
  return m ? { kind: m[1] === "l" ? "lead" : "invite", id: m[2]!, sig: m[3]! } : null;
}

/** HMAC-SHA256 of `message`, base64url without padding (43 characters). */
export async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  let s = "";
  for (const b of mac) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function remindToken(
  secret: string,
  inviteId: string,
  tokenHash: string,
): Promise<string> {
  const sig = await sign(secret, `link:${inviteId}:${tokenHash}`);
  return `r${inviteId.replace(/-/g, "")}${sig.slice(0, 22)}`;
}

export async function stopToken(
  secret: string,
  kind: "lead" | "invite",
  id: string,
): Promise<string> {
  return `${kind === "lead" ? "l" : "i"}.${id}.${await sign(secret, `stop:${kind}:${id}`)}`;
}

/** Equal strings, compared in time that doesn't depend on where they differ. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The staff screens' line for one person, from the plan. */
export function reminderLine(
  plan: ReminderPlan,
  sent: number,
  lastAt: Date | null,
  when: (d: Date) => string,
): string {
  const last = sent > 0 && lastAt ? `Reminder ${sent} sent ${when(lastAt)}` : "";
  switch (plan.kind) {
    case "stopped":
      return `${last ? `${last}. ` : ""}Reminders stopped ${when(plan.at)}.`;
    case "done":
      return sent >= MAX_REMINDERS ? `${last}. No more reminders.` : `${last || "No reminders"}.`;
    case "missed":
      return "No reminders (started before they began, or too long ago).";
    case "next":
      return `${last ? `${last}. ` : ""}${plan.due ? `Reminder ${plan.n} going out now` : `Next reminder ${when(plan.at)}`}.`;
  }
}

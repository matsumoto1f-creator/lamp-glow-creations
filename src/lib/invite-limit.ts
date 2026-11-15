// Daily limit on application emails (2026-11-14).
//
// Application links go out by email from Lamp's own mailbox (partners@getlamp.app), the same
// mailbox and domain the cold-email engine warms up. A rep can type in any address, so without a
// daily ceiling one person, or anyone holding their login, could send thousands of emails from
// getlamp.app in a day and get the domain marked as spam. The ceiling is per person who presses
// Send, per New York day. Links to copy are never limited: the rep sends those themselves.
//
// Pure functions only, shared by the server route and the tests.

/** Application emails one person may send in a New York day. */
export const DAILY_EMAILS = { rep: 30, admin: 100 } as const;

export function dailyEmailLimit(isAdmin: boolean): number {
  return isAdmin ? DAILY_EMAILS.admin : DAILY_EMAILS.rep;
}

/** What the sender reads when the day's emails are used up. */
export function limitReached(limit: number): string {
  return `You've sent today's ${limit} application emails. Copy the link and send it yourself, or email it tomorrow.`;
}

const ZONE = "America/New_York";

/** The New York wall clock of an instant, read as if it were UTC (milliseconds). */
function wallClock(at: Date): number {
  const parts = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)] as const),
  );
  const n = (k: string) => parts.get(k as Intl.DateTimeFormatPartTypes) ?? 0;
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/**
 * Midnight in New York on the day that contains `now`, as an instant. Right on the days the
 * clocks change: the offset is read again at midnight itself, not only at `now`.
 */
export function newYorkDayStart(now: Date): Date {
  const whole = Math.floor(now.getTime() / 1000) * 1000;
  const wall = wallClock(new Date(whole));
  const midnightWall = wall - (wall % 86_400_000);
  let start = midnightWall - (wall - whole);
  start = midnightWall - (wallClock(new Date(start)) - start);
  return new Date(start);
}

/** How many more emails fit today, never below zero. */
export function roomLeft(limit: number, sentToday: number): number {
  return Math.max(0, limit - Math.max(0, sentToday));
}

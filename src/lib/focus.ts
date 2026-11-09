// Focus tools, step 1: the daily ring. How many live conversations a rep has had today, out of a
// target of 20. Decided with Asad on 2026-11-09:
//   * a conversation is a lead the rep spoke to (any outcome but New and No answer) WITH a note,
//     so nobody chases the counter with empty clicks. "Not a fit" and "Do not call" count the same
//     as any other outcome: they were a real conversation, and nobody should be tempted to keep
//     calling to earn a tick.
//   * it starts with Asad and Stevie only (the pilot), before the rest of the team.
// Counted from what Lamp already stores on an engine lead: its status, its note, and worked_at, the
// time the database stamps when the status changes. No imports, so the Deno tests load it as is.

export const DAILY_TARGET = 20;

/** Rep link names that see the focus tools while they're being tried out. */
export const FOCUS_PILOT: readonly string[] = ["asad", "stevie"];
export const inFocusPilot = (repSlug: string | null | undefined) =>
  !!repSlug && FOCUS_PILOT.includes(repSlug);

/** Fired on window when a lead's status or note is saved, so the ring updates at once. */
export const LEAD_WORKED_EVENT = "lamp:lead-worked";

/** Outcomes that mean nobody was reached. */
const NOT_A_CONVERSATION = new Set(["new", "no_answer"]);

export type WorkedLead = { status: string; notes: string | null; worked_at: string | null };

/** The start of the rep's own day, as a time the database can compare with. */
export function dayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const workedToday = (l: WorkedLead, now: Date) =>
  !!l.worked_at && Date.parse(l.worked_at) >= dayStart(now).getTime();

const spoke = (l: WorkedLead) => !NOT_A_CONVERSATION.has(l.status);
const hasNote = (l: WorkedLead) => (l.notes ?? "").trim().length >= 3;

export type DayCount = {
  /** live conversations today: spoke to them, and wrote a note */
  conversations: number;
  /** spoke to them today but no note yet: add one and it counts */
  missingNote: number;
};

export function countToday(leads: readonly WorkedLead[], now: Date): DayCount {
  let conversations = 0;
  let missingNote = 0;
  for (const l of leads) {
    if (!workedToday(l, now) || !spoke(l)) continue;
    if (hasNote(l)) conversations++;
    else missingNote++;
  }
  return { conversations, missingNote };
}

/** How full the ring is, 0 to 1. It stops at full; the number keeps counting. */
export const ringFill = (count: number, target = DAILY_TARGET) =>
  target <= 0 ? 0 : Math.max(0, Math.min(1, count / target));

/** The line under the number. */
export function ringLine(count: number, target = DAILY_TARGET): string {
  if (count >= target) return count === target ? "Target hit." : `${count - target} past target.`;
  const left = target - count;
  return count === 0 ? "First one starts the day." : `${left} to go.`;
}

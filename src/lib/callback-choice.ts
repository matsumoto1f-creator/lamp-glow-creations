// What the callback picker on a lead would save, worked out from its two boxes. Apart from the
// component so the tests can load it.
import { callbackAt } from "./calendar.ts";

export type CallbackChoice = {
  /** the moment to save; null when there is nothing to save */
  at: string | null;
  /** why Save is off, in words the rep can act on; "" when it is on or nothing was typed */
  problem: string;
};

/**
 * `day` and `time` are the boxes ("2026-11-25", "14:30" or ""), `saved` is what the lead holds
 * now, `today` is today's New York day. A day in the past, a half-typed value and an unchanged
 * value save nothing.
 */
export function callbackChoice(
  day: string,
  time: string,
  saved: string | null,
  today: string,
): CallbackChoice {
  if (!day) return { at: null, problem: time ? "Pick the day too." : "" };
  const at = callbackAt(day, time);
  if (!at) return { at: null, problem: "That day or time isn't complete." };
  if (day < today) return { at: null, problem: "That day has passed. Pick today or later." };
  if (saved && Date.parse(saved) === Date.parse(at)) return { at: null, problem: "" };
  return { at, problem: "" };
}

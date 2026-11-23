// The one-page application on a phone: getting a merchant from "Still needed before you can sign"
// to the boxes that are still empty. On a phone the form is a picture about 350 px wide and each
// box on it is about 6 px tall, so "fill in the boxes marked in red" alone left a merchant at the
// bottom of the page with a greyed button and nothing to press (2026-11-23: a merchant whose rep
// had filled the form in with them could not add their SSN and date of birth, the only two things
// left). No imports, so the tests can load it.

/** Asked below the form, not in a box on it. */
export const QUESTION_GAPS = [
  "whether the business or an owner has filed for bankruptcy",
  "whether you own any real estate",
  "whether you have business funding with a balance today",
] as const;

export const isQuestionGap = (m: string) => (QUESTION_GAPS as readonly string[]).includes(m);

/**
 * The next unfinished box after this one, in the order the boxes are read; past the last one it
 * starts again from the top. Null when no other box is unfinished.
 */
export function nextGap(gaps: readonly number[], from: number): number | null {
  const others = gaps.filter((i) => i !== from).sort((a, b) => a - b);
  if (others.length === 0) return null;
  return others.find((i) => i > from) ?? others[0]!;
}

/**
 * Where "Fill in what's missing" goes: the first unfinished box on the form, else the two
 * questions under it, else nowhere (only the signature is left).
 */
export function fixTarget(
  gaps: readonly number[],
  todo: readonly string[],
): { kind: "box"; index: number } | { kind: "questions" } | null {
  if (gaps.length) return { kind: "box", index: Math.min(...gaps) };
  if (todo.some(isQuestionGap)) return { kind: "questions" };
  return null;
}

/** "owner's date of birth, owner's SSN (nine digits)" and, past a handful, "and 4 more". */
export function gapList(todo: readonly string[], max = 5): string {
  if (todo.length <= max) return todo.join(", ");
  return `${todo.slice(0, max).join(", ")} and ${todo.length - max} more`;
}

/** What the card over the form says is left, e.g. "2 things left for you to add". */
export function gapHeadline(todo: readonly string[], filledBy: string | null): string {
  const n = todo.length;
  const things = n === 1 ? "1 thing" : `${n} things`;
  return filledBy
    ? `${filledBy} filled this in with you. ${things} left for you to add:`
    : `${things} left before you can sign:`;
}

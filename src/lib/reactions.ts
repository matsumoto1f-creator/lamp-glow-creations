// Emoji reactions on chat messages (20261112120000_chat_reactions_gifs.sql). The database keeps
// one row per person, message and emoji; this turns a conversation's rows into the chips under
// each message. No imports, so the Deno tests load it as is.

export type ReactionRow = { message_id: number; user_id: string; emoji: string };

export type ReactionChip = {
  emoji: string;
  count: number;
  /** the reader put this one on */
  mine: boolean;
};

/** The six offered first; the full emoji panel is one more tap away. */
export const QUICK_REACTIONS: readonly string[] = ["👍", "❤️", "😂", "🎉", "🔥", "👀"];

/** The database's limit: different emojis from one person on one message. */
export const MAX_OWN_REACTIONS = 6;

/**
 * Chips for each message: one per emoji, in the order the emojis first appear, with how many
 * people used it and whether the reader is one of them. The same person and emoji twice (it can't
 * happen in the database, but a stale read could repeat a row) counts once.
 */
export function groupReactions(
  rows: readonly ReactionRow[],
  me: string,
): Map<number, ReactionChip[]> {
  const out = new Map<number, ReactionChip[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r.emoji !== "string" || !r.emoji) continue;
    const key = `${r.message_id}|${r.user_id}|${r.emoji}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let chips = out.get(r.message_id);
    if (!chips) out.set(r.message_id, (chips = []));
    let chip = chips.find((c) => c.emoji === r.emoji);
    if (!chip) chips.push((chip = { emoji: r.emoji, count: 0, mine: false }));
    chip.count++;
    if (r.user_id === me) chip.mine = true;
  }
  return out;
}

/** Whether tapping this emoji puts it on or takes it off, and whether the reader has room for one more. */
export function nextReaction(
  chips: readonly ReactionChip[] | undefined,
  emoji: string,
): "add" | "remove" | "full" {
  const mine = (chips ?? []).filter((c) => c.mine);
  if (mine.some((c) => c.emoji === emoji)) return "remove";
  return mine.length >= MAX_OWN_REACTIONS ? "full" : "add";
}

/** "2 people" style wording for a chip's label. */
export const reactionLabel = (c: ReactionChip): string =>
  `${c.emoji} ${c.count} ${c.count === 1 ? "person" : "people"}${c.mine ? ", including you. Tap to take yours off." : ". Tap to add yours."}`;

// Emojis for Lamp's chat: the small set the picker shows, where a picked one goes in the message,
// and the "recently used" row kept in the browser. A message is plain text, so an emoji is just
// characters in it: nothing changes in the database or in how a message is sent. No imports, so
// the Deno tests load it as is.

export type EmojiGroup = { id: string; label: string; emojis: readonly string[] };

/** A row of emojis written as one spaced string, so the list stays readable here. */
const set = (row: string): readonly string[] => row.split(" ");

/** What the picker offers. Work chat, so it is short: reactions, hands, money and the working day. */
export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    id: "faces",
    label: "Faces",
    emojis: set(
      "😀 😄 😁 😂 🤣 😊 🙂 😉 😎 🤩 😍 🥳 😇 🤔 🤨 😐 😬 🙄 😅 😴 😤 😡 😢 😭 😱 🤯 🥱 🤝 🫡 🤫 🤐 💀",
    ),
  },
  {
    id: "hands",
    label: "Hands",
    emojis: set("👍 👎 👏 🙌 🙏 💪 👊 ✊ 🤞 👌 ✌️ 🤙 👋 ☝️ 👀 🫶"),
  },
  {
    id: "work",
    label: "Work and money",
    emojis: set("💰 💵 💸 🤑 🏦 📈 📉 📊 📞 ☎️ 📱 📧 📝 📄 📎 ✍️ 🗓️ ⏰ ⏳ 🎯 🚀 🏆 🥇 💼"),
  },
  {
    id: "signs",
    label: "Signs",
    emojis: set("✅ ❌ ⚠️ ❗ ❓ 🔥 💯 ⭐ 🎉 🎊 ❤️ 💚 💔 👑 💡 🔔 ☕ 🍕 🍻 🥂 🌞 🌧️ 🚗 ✈️"),
  },
];

export const ALL_EMOJIS: readonly string[] = EMOJI_GROUPS.flatMap((g) => g.emojis);

export const RECENT_KEY = "lamp.chat.emoji.v1";
export const RECENT_MAX = 16;

/** The saved recent list, newest first. Anything that isn't one of the picker's emojis is dropped. */
export function readRecent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== "string" || !ALL_EMOJIS.includes(x) || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      if (out.length === RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** The recent list after using one: it moves to the front, with no repeats, capped. */
export const addRecent = (list: readonly string[], emoji: string): string[] =>
  [emoji, ...list.filter((e) => e !== emoji)].slice(0, RECENT_MAX);

export type Inserted = { text: string; caret: number; added: boolean };

/**
 * Puts an emoji into the message where the cursor is, replacing any selected text. If the message
 * would go past its length limit, nothing changes. Positions are counted the way a text box counts
 * them, and are clamped, so a stale cursor position can't split the text in the wrong place.
 */
export function insertEmoji(
  text: string,
  start: number | null | undefined,
  end: number | null | undefined,
  emoji: string,
  max: number,
): Inserted {
  const len = text.length;
  const clamp = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(len, Math.trunc(n))) : len;
  const a = clamp(start);
  const b = Math.max(a, clamp(end ?? start));
  const next = text.slice(0, a) + emoji + text.slice(b);
  if (!emoji || next.length > max) return { text, caret: b, added: false };
  return { text: next, caret: a + emoji.length, added: true };
}

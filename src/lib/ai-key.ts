// Lamp's Anthropic key, as the AI activity page talks about it. The key itself never comes back
// to the browser: the page only knows where the key in use comes from, who saved it and when.
// No imports, so the Deno tests load it as is.

/** Where the key Lamp is using comes from: the server's secrets, one saved on this page, or none. */
export type KeySource = "secrets" | "saved" | null;

export type KeyInfo = {
  source: KeySource;
  /** a key is saved on this page (it may be idle while the server's secrets hold one) */
  saved: boolean;
  saved_by: string | null;
  saved_at: string | null;
};

export const KEY_PREFIX = "sk-ant-";

/** Pasted text, tidied: spaces, line breaks and wrapping quotes from a copy and paste removed. */
export const tidyKey = (raw: unknown): string =>
  typeof raw === "string" ? raw.replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "") : "";

/** What's wrong with a pasted key, in plain words, or null when it looks like an Anthropic key. */
export function keyProblem(raw: unknown): string | null {
  const k = tidyKey(raw);
  if (!k) return "Paste the key first.";
  if (!k.startsWith(KEY_PREFIX))
    return `An Anthropic key starts with ${KEY_PREFIX}. Copy it again from the Anthropic console.`;
  if (k.length < 40) return "That key is too short. Copy the whole key.";
  if (k.length > 300) return "That's longer than a key. Paste only the key.";
  if (!/^[A-Za-z0-9_-]+$/.test(k))
    return "A key holds only letters, numbers, dashes and underscores.";
  return null;
}

/** The line under "Anthropic key" on the page. Never includes any part of the key. */
export function keyLine(info: KeyInfo, day: (iso: string) => string): string {
  if (info.source === "secrets")
    return info.saved
      ? "Set in the server's secrets. The key saved here is not in use."
      : "Set in the server's secrets.";
  if (info.source === "saved") {
    const by = info.saved_by ? ` by ${info.saved_by}` : "";
    const on = info.saved_at ? ` on ${day(info.saved_at)}` : "";
    return `Saved here${by}${on}.`;
  }
  return "Not set. Claude is off until a key is added.";
}

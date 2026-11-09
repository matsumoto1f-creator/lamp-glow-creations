// The Messages side panel on the staff page: what it remembers between pages and visits. It stays
// open beside whatever tab the person is on, so the state lives here and not in the page's address.
// No imports, so the Deno tests load it as is.

export const DOCK_KEY = "lamp.chat.dock.v1";
/** Fired on window to open the panel from anywhere (the bell, an old Messages link). */
export const CHAT_OPEN_EVENT = "lamp:chat-open";
/** From this width up the panel sits beside the page; below it, it covers the screen. */
export const DOCK_WIDE = "(min-width: 1024px)";

export type DockState = { open: boolean; thread: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the panel opens as. On a wide screen: as it was left, and open the first time (the point is
 * to see the team while you work). On a phone it covers the screen, so it never opens by itself on
 * arrival; the conversation it was on is kept for when they tap Messages.
 */
export function readDock(raw: string | null | undefined, wide: boolean): DockState {
  let saved: { open?: unknown; thread?: unknown } = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object") saved = v as typeof saved;
  } catch {
    /* nothing usable saved */
  }
  const thread = typeof saved.thread === "string" && UUID.test(saved.thread) ? saved.thread : null;
  const open = wide ? (typeof saved.open === "boolean" ? saved.open : true) : false;
  return { open, thread };
}

export const writeDock = (s: DockState): string =>
  JSON.stringify({ open: s.open, thread: s.thread });

/** A conversation id from an old Messages link or an open request, or null. */
export const dockThread = (v: unknown): string | null =>
  typeof v === "string" && UUID.test(v) ? v : null;

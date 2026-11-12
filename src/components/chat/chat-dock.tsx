import { useEffect, useState } from "react";
import { MessageSquare, PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHAT_OPEN_EVENT,
  DOCK_KEY,
  DOCK_WIDE,
  dockThread,
  readDock,
  writeDock,
  type DockState,
} from "@/lib/chat-dock";
import { btnPrimary } from "@/components/site/layout";
import { Messages } from "@/components/chat/messages";

/**
 * Messages as a side panel on the staff page, in place of a tab: it stays open beside whatever the
 * person is working on (Files, Engine leads, a file, a lead) and keeps its conversation while they
 * move between pages. On a wide screen it sits on the right and the page makes room for it; on a
 * phone the Messages button opens it over the page. Closed, it is a Messages button with the
 * unread count. Where it was left (open or closed, which conversation) is remembered in this
 * browser.
 */
export function useChatDock(): {
  state: DockState;
  ready: boolean;
  set: (patch: Partial<DockState>) => void;
} {
  const [state, setState] = useState<DockState>({ open: false, thread: null });
  // read after the first render, so the server's page and the browser's match
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(DOCK_KEY);
    } catch {
      /* storage blocked: it just starts fresh each visit */
    }
    setState(readDock(raw, window.matchMedia(DOCK_WIDE).matches));
    setReady(true);
  }, []);

  const set = (patch: Partial<DockState>) =>
    setState((s) => {
      const next = { ...s, ...patch };
      try {
        window.localStorage.setItem(DOCK_KEY, writeDock(next));
      } catch {
        /* not remembered, still works */
      }
      return next;
    });

  // the bell, or an old Messages link, asks for the panel
  useEffect(() => {
    const onOpen = (e: Event) => {
      const thread = dockThread((e as CustomEvent<{ thread?: unknown }>).detail?.thread);
      set(thread ? { open: true, thread } : { open: true });
    };
    window.addEventListener(CHAT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, onOpen);
  }, []);

  return { state, ready, set };
}

export function ChatDock({
  userId,
  isAdmin,
  unread,
  state,
  set,
}: {
  userId: string;
  isAdmin: boolean;
  unread: number;
  state: DockState;
  set: (patch: Partial<DockState>) => void;
}) {
  if (!state.open)
    return (
      <button
        type="button"
        className={cn(btnPrimary, "fixed bottom-5 right-5 z-30 px-5 py-3 shadow-lg")}
        onClick={() => set({ open: true })}
        aria-label={unread > 0 ? `Open messages, ${unread} unread` : "Open messages"}
        data-chat-dock-open
      >
        <MessageSquare className="size-4" /> Messages
        {unread > 0 && (
          <span className="rounded-full bg-ink px-1.5 text-xs text-white" data-chat-dock-unread>
            {unread}
          </span>
        )}
      </button>
    );

  return (
    <aside
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-night",
        "lg:inset-auto lg:bottom-4 lg:right-4 lg:top-24 lg:z-30 lg:w-[380px] lg:rounded-2xl lg:shadow-xl lg:ring-1 lg:ring-line",
      )}
      aria-label="Messages"
      data-chat-dock
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <MessageSquare className="size-4 text-forest" />
        <h2 className="font-display text-base font-semibold">Messages</h2>
        {unread > 0 && (
          <span className="rounded-full bg-leaf px-1.5 text-xs text-ink" data-chat-dock-unread>
            {unread}
          </span>
        )}
        <button
          type="button"
          className="-mr-2 ml-auto grid size-10 place-items-center rounded-full hover:bg-sand/60"
          onClick={() => set({ open: false })}
          aria-label="Close messages"
          data-chat-dock-close
        >
          <PanelRightClose className="size-5" />
        </button>
      </div>
      <Messages
        compact
        userId={userId}
        isAdmin={isAdmin}
        thread={state.thread ?? undefined}
        onThread={(thread) => set({ thread: thread ?? null })}
      />
    </aside>
  );
}

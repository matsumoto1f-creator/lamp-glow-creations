import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  authorLabel,
  CHAT_READ_EVENT,
  chatError,
  chatRefusal,
  LIVE_POLL_MS,
  MAX_LENGTH,
  MESSAGE_COLUMNS,
  messageTime,
  PAGE,
  POLL_MS,
  type ChatMessage,
} from "@/lib/chat";
import { btnOutline, btnPrimary } from "@/components/site/layout";

/**
 * One conversation (20261110120000_chat_staff.sql). The database decides who may read and write and
 * stamps who wrote each message; this only shows and sends. It looks for new messages every 15
 * seconds; once 20261110130000_chat_realtime.sql has run they arrive at once, with a slower look as a
 * backstop. Phone first: on a narrow screen the messages flow with the page and the composer stays
 * stuck to the bottom; on a wide one the messages scroll inside the panel.
 */
export function ChatThread({
  threadId,
  userId,
  isAdmin = false,
  placeholder,
  emptyText,
  onRead,
}: {
  threadId: string;
  userId: string;
  isAdmin?: boolean;
  placeholder: string;
  emptyText: string;
  /** after the conversation is marked read (the inbox refreshes its unread marks) */
  onRead?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [redacting, setRedacting] = useState<{ id: number; reason: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastSeen = useRef<number>(0);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error: err } = await sb
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE);
    if (err) return; // keep what's on screen; the next look tries again
    const list = (data as ChatMessage[]).slice().reverse();
    setMessages(list);
    const newest = list[list.length - 1];
    if (newest && newest.id !== lastSeen.current) {
      lastSeen.current = newest.id;
      // seen it. (A Supabase query only goes out once something awaits or .then()s it, so
      // `void sb.rpc(...)` alone would send nothing.)
      sb.rpc("mark_thread_read", { _thread: threadId }).then(
        () => {
          window.dispatchEvent(new Event(CHAT_READ_EVENT));
          onReadRef.current?.();
        },
        () => undefined,
      );
    }
  }, [threadId]);

  useEffect(() => {
    setMessages(null);
    lastSeen.current = 0;
    void load();
  }, [load]);

  // live: a new row in this conversation reloads it (only rows this person may read arrive)
  const [streaming, setStreaming] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    const channel = sb
      .channel(`chat:${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        () => void load(),
      )
      .subscribe((status) => setStreaming(status === "SUBSCRIBED"));
    return () => {
      setStreaming(false);
      void sb.removeChannel(channel);
    };
  }, [threadId, load]);

  // and a look every so often while the page is in front: often until live updates are on
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const t = window.setInterval(tick, streaming ? LIVE_POLL_MS : POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, streaming]);

  // keep the newest message in view: inside the panel on a wide screen, on the page on a phone
  const count = messages?.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !count) return;
    // the list scrolls itself on a wide screen; on a phone the page does
    if (getComputedStyle(el).overflowY === "auto") el.scrollTop = el.scrollHeight;
    else endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  async function send() {
    const sb = getSupabase();
    if (!sb || sending) return;
    const refusal = chatRefusal(body);
    if (refusal) {
      setError(refusal);
      return;
    }
    setSending(true);
    setError("");
    const { error: err } = await sb
      .from("chat_messages")
      .insert({ thread_id: threadId, body: body.trim() });
    setSending(false);
    if (err) {
      setError(chatError(err));
      return;
    }
    setBody("");
    await load();
  }

  async function redact() {
    const sb = getSupabase();
    if (!sb || !redacting) return;
    const { error: err } = await sb.rpc("redact_message", {
      _id: redacting.id,
      _reason: redacting.reason,
    });
    if (err) {
      setError(chatError(err));
      return;
    }
    setRedacting(null);
    await load();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chat-thread={threadId}>
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 py-3 lg:overflow-y-auto lg:pr-1"
        aria-live="polite"
      >
        {messages === null ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-smoke" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-smoke">{emptyText}</p>
        ) : (
          messages.map((m) => {
            const mine = !!m.author && m.author === userId;
            if (m.kind !== "text")
              return (
                <p key={m.id} className="text-center text-xs text-smoke">
                  {m.body} · {messageTime(m.created_at)}
                </p>
              );
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                    mine ? "bg-forest text-white" : "bg-white ring-1 ring-line",
                  )}
                >
                  <p className={cn("text-xs", mine ? "text-white/75" : "text-smoke")}>
                    {authorLabel(m, userId)} · {messageTime(m.created_at)}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 whitespace-pre-wrap break-words",
                      m.redacted_at && "italic opacity-75",
                    )}
                  >
                    {m.body}
                  </p>
                  {isAdmin && !m.redacted_at && (
                    <button
                      type="button"
                      className={cn(
                        "mt-1 text-xs underline",
                        mine ? "text-white/75" : "text-smoke",
                      )}
                      onClick={() => setRedacting({ id: m.id, reason: "" })}
                    >
                      Remove
                    </button>
                  )}
                  {redacting?.id === m.id && (
                    <div className="mt-2 space-y-2 text-ink">
                      <input
                        aria-label="Why it's being removed"
                        className="w-full rounded-full bg-white px-3 py-1.5 text-xs ring-1 ring-line"
                        placeholder="Why it's being removed"
                        value={redacting.reason}
                        onChange={(e) => setRedacting({ id: m.id, reason: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={cn(btnPrimary, "px-3 py-1 text-xs")}
                          disabled={!redacting.reason.trim()}
                          onClick={() => void redact()}
                        >
                          Remove for everyone
                        </button>
                        <button
                          type="button"
                          className={cn(btnOutline, "px-3 py-1 text-xs")}
                          onClick={() => setRedacting(null)}
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        {/* scroll-margin keeps the newest message clear of the sticky composer on a phone */}
        <div ref={endRef} className="scroll-mb-28" />
      </div>

      <div
        className="sticky bottom-0 -mx-4 rounded-b-2xl border-t border-line bg-white px-4 pt-3 lg:static lg:mx-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        data-chat-composer
      >
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Message"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl bg-white px-4 py-2.5 text-base ring-1 ring-line sm:text-sm"
            rows={1}
            placeholder={placeholder}
            maxLength={MAX_LENGTH}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className={cn(btnPrimary, "size-11 shrink-0 p-0")}
            disabled={sending || !body.trim()}
            onClick={() => void send()}
            aria-label="Send"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

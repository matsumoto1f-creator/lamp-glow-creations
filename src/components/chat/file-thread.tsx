import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  authorLabel,
  chatError,
  chatMissing,
  chatRefusal,
  lendingWords,
  MAX_LENGTH,
  MESSAGE_COLUMNS,
  messageTime,
  PAGE,
  POLL_MS,
  type ChatMessage,
} from "@/lib/chat";
import { btnOutline, btnPrimary } from "@/components/site/layout";

/**
 * A file's conversation with its merchant (20261109120000_chat_merchant_threads.sql). The same
 * component on both sides: the merchant on /account, staff in the file view. The database decides
 * who may read and write it and stamps who wrote each message; this only shows and sends.
 * Renders nothing when the conversation's SQL hasn't run yet, so publishing first is harmless.
 */
export function FileThread({
  applicationId,
  viewer,
  userId,
  isAdmin = false,
  placeholder,
  emptyText,
  onUnavailable,
}: {
  applicationId: string;
  viewer: "merchant" | "staff";
  userId: string;
  isAdmin?: boolean;
  placeholder: string;
  emptyText: string;
  onUnavailable?: () => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // staff: the lending words in the draft they've been warned about; sending again sends it
  const [warned, setWarned] = useState<string | null>(null);
  const [redacting, setRedacting] = useState<{ id: number; reason: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSeen = useRef<number>(0);

  const load = useCallback(async (thread: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error: err } = await sb
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("thread_id", thread)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE);
    if (err) return; // keep what's on screen; the next poll tries again
    const list = (data as ChatMessage[]).slice().reverse();
    setMessages(list);
    const newest = list[list.length - 1];
    if (newest && newest.id !== lastSeen.current) {
      lastSeen.current = newest.id;
      // seen it: clears the unread mark and this thread's bell item
      void sb.rpc("mark_thread_read", { _thread: thread });
    }
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    setState("loading");
    setMessages(null);
    lastSeen.current = 0;
    (async () => {
      const t = await sb.rpc("open_file_thread", { _application_id: applicationId });
      if (!live) return;
      if (t.error || !t.data) {
        if (chatMissing(t.error)) {
          setState("missing");
          onUnavailable?.();
        } else setState("error");
        return;
      }
      setThreadId(t.data);
      await load(t.data);
      if (live) setState("ready");
    })();
    return () => {
      live = false;
    };
  }, [applicationId, load, onUnavailable]);

  // look for new messages while the page is in front
  useEffect(() => {
    if (!threadId) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load(threadId);
    };
    const t = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [threadId, load]);

  // keep the newest message in view
  const count = messages?.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  async function send(force = false) {
    const sb = getSupabase();
    if (!sb || !threadId || sending) return;
    const refusal = chatRefusal(body);
    if (refusal) {
      setError(refusal);
      return;
    }
    if (viewer === "staff" && !force) {
      const words = lendingWords(body);
      if (words.length) {
        setWarned(words.join(", "));
        return;
      }
    }
    setSending(true);
    setError("");
    setWarned(null);
    const { error: err } = await sb
      .from("chat_messages")
      .insert({ thread_id: threadId, body: body.trim() });
    setSending(false);
    if (err) {
      setError(chatError(err));
      return;
    }
    setBody("");
    await load(threadId);
  }

  async function redact() {
    const sb = getSupabase();
    if (!sb || !redacting || !threadId) return;
    const { error: err } = await sb.rpc("redact_message", {
      _id: redacting.id,
      _reason: redacting.reason,
    });
    if (err) {
      setError(chatError(err));
      return;
    }
    setRedacting(null);
    await load(threadId);
  }

  if (state === "missing") return null;
  if (state === "error")
    return (
      <p className="mt-3 text-sm text-smoke">
        Messages couldn't load just now. Refresh the page to try again.
      </p>
    );

  return (
    <div className="mt-4" data-chat-thread={threadId ?? ""}>
      <div
        ref={listRef}
        className="max-h-96 space-y-3 overflow-y-auto rounded-xl bg-sand/60 p-3 ring-1 ring-line"
        aria-live="polite"
      >
        {messages === null ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="size-5 animate-spin text-smoke" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-smoke">{emptyText}</p>
        ) : (
          messages.map((m) => {
            const mine = !!m.author && m.author === userId;
            if (m.kind !== "text")
              return (
                <p
                  key={m.id}
                  className="flex items-center justify-center gap-1.5 text-center text-xs text-smoke"
                >
                  <Paperclip className="size-3.5" />
                  {authorLabel(m, viewer, userId)}: {m.body}
                  <span className="text-dim">· {messageTime(m.created_at)}</span>
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
                    {authorLabel(m, viewer, userId)} · {messageTime(m.created_at)}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 whitespace-pre-wrap break-words",
                      m.redacted_at && "italic opacity-75",
                    )}
                  >
                    {m.body}
                  </p>
                  {isAdmin && !m.redacted_at && viewer === "staff" && (
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
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          aria-label="Message"
          className="min-h-12 flex-1 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-line"
          placeholder={placeholder}
          maxLength={MAX_LENGTH}
          value={body}
          disabled={!threadId}
          onChange={(e) => {
            setBody(e.target.value);
            setWarned(null);
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
          className={cn(btnPrimary, "px-4 py-3")}
          disabled={!threadId || sending || !body.trim()}
          onClick={() => void send()}
          aria-label="Send"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
      {warned && (
        <div className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs ring-1 ring-amber-500/40">
          This message says “{warned}”. Lamp arranges merchant cash advances, a purchase of future
          receivables, so reword it before it goes to the merchant.{" "}
          <button type="button" className="underline" onClick={() => void send(true)}>
            Send as written
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

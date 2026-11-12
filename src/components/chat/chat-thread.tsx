import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  authorLabel,
  CHAT_READ_EVENT,
  chatError,
  chatRefusal,
  lendingWords,
  LIVE_POLL_MS,
  MAX_LENGTH,
  MESSAGE_COLUMNS,
  messageTime,
  PAGE,
  POLL_MS,
  type ChatMessage,
  type Viewer,
} from "@/lib/chat";
import { btnOutline, btnPrimary } from "@/components/site/layout";
import { insertEmoji } from "@/lib/emoji";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { GifPicker } from "@/components/chat/gif-picker";
import { MessageReactions } from "@/components/chat/message-reactions";
import { isGifUrl } from "@/lib/gifs";
import { groupReactions, nextReaction, type ReactionChip, type ReactionRow } from "@/lib/reactions";

/**
 * One conversation (20261110120000_chat_staff.sql, 20261110140000_chat_merchant.sql). The database
 * decides who may read and write and stamps who wrote each message; this only shows and sends. It
 * looks for new messages every 15 seconds; once 20261110130000_chat_realtime.sql has run they arrive
 * at once, with a slower look as a backstop.
 * layout "page" (Staff > Messages), phone first: on a narrow screen the messages flow with the page
 * and the composer stays stuck to the bottom; on a wide one the messages scroll inside the panel.
 * layout "panel" (the account page, the file view): a box that scrolls itself, at any width.
 * layout "dock" (the Messages side panel): fills the panel, the messages scroll inside it and the
 * composer stays at the bottom, at any width.
 */
export function ChatThread({
  threadId,
  userId,
  isAdmin = false,
  placeholder,
  emptyText,
  onRead,
  viewer = "staff",
  layout = "page",
  warnLending = false,
  gifs = false,
}: {
  threadId: string;
  userId: string;
  /** who is reading: names show as they know them */
  viewer?: Viewer;
  layout?: "page" | "panel" | "dock";
  /** staff writing to a merchant: warn about words that call an MCA lending before sending */
  warnLending?: boolean;
  isAdmin?: boolean;
  /** a staff room or direct message: offer the GIF button (never in a merchant's conversation) */
  gifs?: boolean;
  placeholder: string;
  emptyText: string;
  /** after the conversation is marked read (the inbox refreshes its unread marks) */
  onRead?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // null until the reactions table answers: before its database file has run, no reaction buttons show
  const [reactions, setReactions] = useState<Map<number, ReactionChip[]> | null>(null);
  const [reacting, setReacting] = useState(false);
  const [redacting, setRedacting] = useState<{ id: number; reason: string } | null>(null);
  // the lending words in the draft someone was warned about; sending again sends it as written
  const [warned, setWarned] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
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
    const ids = list.filter((m) => m.kind === "text" || m.kind === "gif").map((m) => m.id);
    if (ids.length) {
      const r = await sb
        .from("chat_reactions" as never)
        .select("message_id,user_id,emoji")
        .in("message_id", ids);
      setReactions(r.error ? null : groupReactions((r.data ?? []) as ReactionRow[], userId));
    }
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
  }, [threadId, userId]);

  useEffect(() => {
    setMessages(null);
    setReactions(null);
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
      // someone reacted: only reactions this person may read arrive, and a reload sorts out which
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reactions" },
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

  // an emoji goes where the cursor is in the message box, and the cursor lands just after it
  const addEmoji = (emoji: string) => {
    const el = boxRef.current;
    const r = insertEmoji(body, el?.selectionStart, el?.selectionEnd, emoji, MAX_LENGTH);
    if (!r.added) return;
    setBody(r.text);
    setWarned(null);
    if (error) setError("");
    requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(r.caret, r.caret);
    });
  };

  /** Puts the reader's reaction on a message, or takes it off if it's already there. */
  async function react(m: ChatMessage, emoji: string) {
    const sb = getSupabase();
    if (!sb || reacting) return;
    const next = nextReaction(reactions?.get(m.id), emoji);
    if (next === "full") {
      setError("That's enough reactions on one message.");
      return;
    }
    setReacting(true);
    const { error: err } =
      next === "remove"
        ? await sb
            .from("chat_reactions" as never)
            .delete()
            .eq("message_id", m.id)
            .eq("user_id", userId)
            .eq("emoji", emoji)
        : await sb.from("chat_reactions" as never).insert({ message_id: m.id, emoji } as never);
    setReacting(false);
    if (err) {
      setError(chatError(err));
      return;
    }
    setError("");
    await load();
  }

  /** Sends a KLIPY address as a GIF message. Returns an error line, or null when it went. */
  async function sendGif(url: string): Promise<string | null> {
    const sb = getSupabase();
    if (!sb || !isGifUrl(url)) return "That isn't a GIF Lamp can show.";
    const { error: err } = await sb
      .from("chat_messages")
      .insert({ thread_id: threadId, body: url, kind: "gif" } as never);
    if (err) return chatError(err);
    await load();
    return null;
  }

  async function send(force = false) {
    const sb = getSupabase();
    if (!sb || sending) return;
    const refusal = chatRefusal(body);
    if (refusal) {
      setError(refusal);
      return;
    }
    if (warnLending && viewer === "staff" && !force) {
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
        className={
          layout === "panel"
            ? "max-h-96 space-y-3 overflow-y-auto rounded-xl bg-sand/60 p-3 ring-1 ring-line"
            : layout === "dock"
              ? "min-h-0 flex-1 space-y-3 overflow-y-auto py-3 pr-1"
              : "min-h-0 flex-1 space-y-3 py-3 lg:overflow-y-auto lg:pr-1"
        }
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
            if (m.kind !== "text" && m.kind !== "gif")
              return (
                <p
                  key={m.id}
                  className="flex items-center justify-center gap-1.5 text-center text-xs text-smoke"
                >
                  {m.kind === "document" && <Paperclip className="size-3.5 shrink-0" />}
                  {m.kind === "document" && `${authorLabel(m, userId, viewer)}: `}
                  {m.body} · {messageTime(m.created_at)}
                </p>
              );
            return (
              <div
                key={m.id}
                className={cn("flex flex-col", mine ? "items-end" : "items-start")}
                data-chat-message={m.kind}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                    mine ? "bg-forest text-white" : "bg-white ring-1 ring-line",
                  )}
                >
                  <p className={cn("text-xs", mine ? "text-white/75" : "text-smoke")}>
                    {authorLabel(m, userId, viewer)} · {messageTime(m.created_at)}
                  </p>
                  {m.kind === "gif" && !m.redacted_at && isGifUrl(m.body) ? (
                    <img
                      src={m.body}
                      alt="GIF"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="mt-1 max-h-56 w-auto max-w-full rounded-xl"
                      data-chat-gif
                    />
                  ) : (
                    <p
                      className={cn(
                        "mt-0.5 whitespace-pre-wrap break-words",
                        m.redacted_at && "italic opacity-75",
                      )}
                    >
                      {m.body}
                    </p>
                  )}
                  {isAdmin && viewer === "staff" && !m.redacted_at && (
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
                {reactions && !m.redacted_at && (
                  <MessageReactions
                    chips={reactions.get(m.id) ?? []}
                    mine={mine}
                    disabled={reacting}
                    onToggle={(emoji) => void react(m, emoji)}
                  />
                )}
              </div>
            );
          })
        )}
        {/* scroll-margin keeps the newest message clear of the sticky composer on a phone */}
        <div ref={endRef} className="scroll-mb-28" />
      </div>

      <div
        className={
          layout === "panel"
            ? "pt-3"
            : layout === "dock"
              ? "border-t border-line pt-3"
              : "sticky bottom-0 -mx-4 rounded-b-2xl border-t border-line bg-white px-4 pt-3 lg:static lg:mx-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0"
        }
        style={
          layout === "panel"
            ? undefined
            : { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }
        }
        data-chat-composer
      >
        <div className="flex items-end gap-2">
          <EmojiPicker onPick={addEmoji} disabled={sending} />
          {gifs && viewer === "staff" && (
            <GifPicker userId={userId} isAdmin={isAdmin} disabled={sending} onSend={sendGif} />
          )}
          <textarea
            ref={boxRef}
            aria-label="Message"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl bg-white px-4 py-2.5 text-base ring-1 ring-line sm:text-sm"
            rows={1}
            placeholder={placeholder}
            maxLength={MAX_LENGTH}
            value={body}
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
            className={cn(btnPrimary, "size-11 shrink-0 p-0")}
            disabled={sending || !body.trim()}
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
    </div>
  );
}

import { gifPreview } from "@/lib/gifs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Hash, Loader2, MessageSquarePlus, Plus, User, Users } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { chatError, chatMissing, INBOX_POLL_MS, type InboxRow } from "@/lib/chat";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { input } from "@/components/staff/field-styles";
import { ChatThread } from "@/components/chat/chat-thread";

type Person = { user_id: string; name: string };

const GROUPS: { kind: InboxRow["kind"]; label: string }[] = [
  { kind: "merchant", label: "Merchants" },
  { kind: "room", label: "Rooms" },
  { kind: "direct", label: "Direct messages" },
];

/**
 * Staff > Messages (20261110120000_chat_staff.sql, 20261110140000_chat_merchant.sql): the team's group
 * chat and the merchants they work. Merchant conversations (the files they work), rooms (All staff,
 * the person's team room, rooms an admin made) and direct messages, newest first with unread marks,
 * and the open conversation. Phone first: on a narrow screen it shows the list or
 * one conversation, never both, with a back control from the conversation to the list.
 * compact (the Messages side panel, chat-dock.tsx): that one-or-the-other form at every width,
 * filling the panel it sits in.
 */
export function Messages({
  userId,
  isAdmin,
  thread,
  onThread,
  compact = false,
}: {
  userId: string;
  isAdmin: boolean;
  thread: string | undefined;
  onThread: (id: string | undefined) => void;
  compact?: boolean;
}) {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [state, setState] = useState<"ready" | "missing" | "error">("ready");
  const [people, setPeople] = useState<Person[]>([]);
  const [composing, setComposing] = useState<"direct" | "room" | null>(null);
  const [to, setTo] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomPeople, setRoomPeople] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error: err } = await sb.rpc("my_chat_inbox");
    if (err) {
      setState(chatMissing(err) ? "missing" : "error");
      setRows([]);
      return;
    }
    setState("ready");
    setRows((data ?? []) as InboxRow[]);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, INBOX_POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("reps")
      .select("user_id,name")
      .eq("active", true)
      .not("user_id", "is", null)
      .order("name")
      .then(({ data }) =>
        setPeople(((data ?? []) as Person[]).filter((p) => p.user_id && p.user_id !== userId)),
      );
  }, [userId]);

  const open = useMemo(() => rows?.find((r) => r.thread_id === thread) ?? null, [rows, thread]);

  async function startDirect() {
    const sb = getSupabase();
    if (!sb || !to) return;
    setBusy(true);
    setError("");
    const { data, error: err } = await sb.rpc("open_direct", { _other: to });
    setBusy(false);
    if (err || !data) {
      setError(chatError(err) || "Couldn't start that conversation.");
      return;
    }
    setComposing(null);
    setTo("");
    await load();
    onThread(data);
  }

  async function makeRoom() {
    const sb = getSupabase();
    if (!sb || !roomName.trim()) return;
    setBusy(true);
    setError("");
    const { data, error: err } = await sb.rpc("create_room", {
      _title: roomName.trim(),
      _members: [...roomPeople],
    });
    setBusy(false);
    if (err || !data) {
      setError(chatError(err) || "Couldn't make that room.");
      return;
    }
    setComposing(null);
    setRoomName("");
    setRoomPeople(new Set());
    await load();
    onThread(data);
  }

  if (state === "missing")
    return (
      <p className={cn("text-sm text-smoke", compact ? "p-4" : "mt-8")}>
        Messages aren't switched on yet: their database update still has to run.
      </p>
    );

  return (
    <div
      className={
        compact ? "flex min-h-0 flex-1 flex-col" : "mt-6 grid gap-5 lg:grid-cols-[340px_1fr]"
      }
      data-staff-messages
    >
      <section
        className={
          compact
            ? cn("min-h-0 flex-1 overflow-y-auto p-3", thread && "hidden")
            : cn(card, "h-fit p-4", thread && "hidden lg:block")
        }
        aria-label="Conversations"
        data-chat-inbox
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btnOutline, "px-3 py-2 text-sm")}
            onClick={() => setComposing(composing === "direct" ? null : "direct")}
          >
            <MessageSquarePlus className="size-4" /> New message
          </button>
          {isAdmin && (
            <button
              type="button"
              className={cn(btnOutline, "px-3 py-2 text-sm")}
              onClick={() => setComposing(composing === "room" ? null : "room")}
            >
              <Plus className="size-4" /> New room
            </button>
          )}
        </div>

        {composing === "direct" && (
          <div className="mt-3 space-y-2">
            <select
              aria-label="Who to message"
              className={input}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">Pick someone on staff</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={cn(btnPrimary, "px-4 py-2 text-sm")}
              disabled={!to || busy}
              onClick={() => void startDirect()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Open conversation
            </button>
          </div>
        )}

        {composing === "room" && isAdmin && (
          <div className="mt-3 space-y-2">
            <input
              aria-label="Room name"
              className={input}
              placeholder="Room name"
              maxLength={80}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl p-2 ring-1 ring-line">
              {people.map((p) => (
                <label key={p.user_id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={roomPeople.has(p.user_id)}
                    onChange={(e) => {
                      const next = new Set(roomPeople);
                      if (e.target.checked) next.add(p.user_id);
                      else next.delete(p.user_id);
                      setRoomPeople(next);
                    }}
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <button
              type="button"
              className={cn(btnPrimary, "px-4 py-2 text-sm")}
              disabled={!roomName.trim() || busy}
              onClick={() => void makeRoom()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Make the room
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        {rows === null ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-smoke" />
          </div>
        ) : state === "error" ? (
          <p className="mt-4 text-sm text-smoke">
            Couldn't load your messages. Refresh to try again.
          </p>
        ) : (
          GROUPS.map((g) => {
            const list = rows.filter((r) => r.kind === g.kind);
            if (!list.length) return null;
            return (
              <div key={g.kind} className="mt-4">
                <p className="px-2 text-xs font-semibold uppercase tracking-wide text-smoke">
                  {g.label}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {list.map((r) => (
                    <li key={r.thread_id}>
                      <button
                        type="button"
                        onClick={() => onThread(r.thread_id)}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm",
                          r.thread_id === thread ? "bg-leaf/15" : "hover:bg-sand/60",
                        )}
                        data-inbox-row={r.kind}
                      >
                        {r.kind === "room" ? (
                          <Hash className="size-4 shrink-0 text-smoke" />
                        ) : r.kind === "direct" ? (
                          <User className="size-4 shrink-0 text-smoke" />
                        ) : (
                          <Users className="size-4 shrink-0 text-smoke" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate", r.unread && "font-semibold")}>
                            {r.title}
                          </span>
                          <span className="block truncate text-xs text-smoke">
                            {gifPreview(r.preview) ?? r.preview ?? r.subtitle}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-smoke">
                          {r.last_message_at ? age(r.last_message_at) : ""}
                        </span>
                        {r.unread && (
                          <span
                            className="size-2.5 shrink-0 rounded-full bg-leaf"
                            aria-label="Unread"
                          />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      <section
        className={
          compact
            ? cn("min-h-0 min-w-0 flex-1 flex-col px-3 pb-3 pt-3", thread ? "flex" : "hidden")
            : cn(
                card,
                "min-h-[calc(100dvh-13rem)] min-w-0 flex-col px-4 pt-4 lg:flex lg:h-[70vh] lg:min-h-0 lg:p-6",
                thread ? "flex" : "hidden",
              )
        }
        aria-label="Conversation"
        data-chat-pane
      >
        {!thread ? (
          <p className="py-16 text-center text-sm text-smoke">
            Pick a conversation, or start one with New message.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <button
                type="button"
                className={cn(
                  "-ml-2 grid size-10 shrink-0 place-items-center rounded-full hover:bg-sand/60",
                  !compact && "lg:hidden",
                )}
                onClick={() => onThread(undefined)}
                aria-label="Back to all messages"
                data-chat-back
              >
                <ChevronLeft className="size-5" />
              </button>
              <div className="min-w-0">
                <h3 className="truncate font-display text-lg font-semibold">
                  {open?.title ?? "Conversation"}
                </h3>
                <p className="truncate text-xs text-smoke">
                  {open?.kind === "merchant" && open.application_id ? (
                    <Link to="/staff" search={{ file: open.application_id }} className="underline">
                      Open the file
                    </Link>
                  ) : (
                    (open?.subtitle ?? "")
                  )}
                </p>
              </div>
              {open?.kind === "merchant" && (
                <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                  The merchant sees this
                </span>
              )}
            </div>
            <ChatThread
              key={thread}
              threadId={thread}
              userId={userId}
              isAdmin={isAdmin}
              placeholder={open?.kind === "merchant" ? "Write to the merchant" : "Write a message"}
              warnLending={open?.kind === "merchant"}
              gifs={!!open && open.kind !== "merchant"}
              emptyText="No messages yet. Say hello."
              layout={compact ? "dock" : "page"}
              onRead={() => void load()}
            />
          </>
        )}
      </section>
    </div>
  );
}

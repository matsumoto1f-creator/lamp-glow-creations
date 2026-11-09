import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Hash, Loader2, MessageSquarePlus, Plus, User, Users } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { chatError, chatMissing, INBOX_POLL_MS, type InboxRow } from "@/lib/chat";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { input } from "@/components/staff/field-styles";
import { ChatThread } from "@/components/chat/file-thread";

type Person = { user_id: string; name: string };

const GROUPS: { kind: InboxRow["kind"]; label: string }[] = [
  { kind: "merchant", label: "Merchants" },
  { kind: "room", label: "Rooms" },
  { kind: "direct", label: "Direct messages" },
];

/**
 * Staff > Messages (20261109130000_chat_staff_messages.sql): every conversation this person may
 * read, newest first, and the open one. Merchants (the files they work), rooms (All staff, their
 * team's, rooms an admin made), and direct messages with anyone on staff.
 */
export function Messages({
  userId,
  isAdmin,
  thread,
  onThread,
}: {
  userId: string;
  isAdmin: boolean;
  thread: string | undefined;
  onThread: (id: string | undefined) => void;
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

  // reading a conversation clears its unread mark: refresh the list when switching
  useEffect(() => {
    if (thread) void load();
  }, [thread, load]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("reps")
      .select("user_id,name,active")
      .eq("active", true)
      .not("user_id", "is", null)
      .order("name")
      .then(({ data }) =>
        setPeople(
          ((data ?? []) as { user_id: string; name: string }[])
            .filter((p) => p.user_id !== userId)
            .map((p) => ({ user_id: p.user_id, name: p.name })),
        ),
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
      <p className="mt-8 text-sm text-smoke">
        Messages aren't switched on yet: their database update still has to run.
      </p>
    );

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[340px_1fr]" data-staff-messages>
      <section className={cn(card, "h-fit p-4")}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btnOutline, "px-3 py-1.5 text-sm")}
            onClick={() => setComposing(composing === "direct" ? null : "direct")}
          >
            <MessageSquarePlus className="size-4" /> New message
          </button>
          {isAdmin && (
            <button
              type="button"
              className={cn(btnOutline, "px-3 py-1.5 text-sm")}
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
              className={cn(btnPrimary, "px-4 py-1.5 text-sm")}
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
                <label key={p.user_id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
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
              className={cn(btnPrimary, "px-4 py-1.5 text-sm")}
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
                          "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm",
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
                          <span className="block truncate text-xs text-smoke">{r.subtitle}</span>
                        </span>
                        <span className="shrink-0 text-xs text-smoke">
                          {r.last_message_at ? age(r.last_message_at) : ""}
                        </span>
                        {r.unread && (
                          <span
                            className="size-2 shrink-0 rounded-full bg-leaf"
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

      <section className={cn(card, "min-w-0 p-6")}>
        {!thread ? (
          <p className="py-16 text-center text-sm text-smoke">
            Pick a conversation, or start one with New message.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-semibold">
                {open?.title ?? "Conversation"}
              </h3>
              {open?.kind === "merchant" && (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                  The merchant sees this
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-smoke">
              {open?.kind === "merchant" && open.application_id ? (
                <Link to="/staff" search={{ file: open.application_id }} className="underline">
                  Open the file
                </Link>
              ) : (
                (open?.subtitle ?? "")
              )}
            </p>
            <ChatThread
              key={thread}
              threadId={thread}
              applicationId={
                open?.kind === "merchant" ? (open.application_id ?? undefined) : undefined
              }
              viewer="staff"
              userId={userId}
              isAdmin={isAdmin}
              placeholder={open?.kind === "merchant" ? "Write to the merchant" : "Write a message"}
              emptyText="No messages yet."
              onRead={() => void load()}
            />
          </>
        )}
      </section>
    </div>
  );
}

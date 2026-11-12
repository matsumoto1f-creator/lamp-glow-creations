// Email replies (2026-11-11): when someone answers one of Lamp's outreach emails, the War Room
// engine posts the reply to /api/engine/reply with the same shared secret as the daily lead push.
// The reply lands in Staff > Email replies as an engine lead (source "email-reply") owned by the rep
// who sent the email, and that rep plus every admin gets a notification with the person's words:
// the owner handles it, the admins catch whatever the owner misses. This file is the part with no
// server or database in it, so the tests can load it.

/** The engine_leads source every email reply is filed under. */
export const REPLY_SOURCE = "email-reply";

/** One call carries at most this many replies (the engine sends them in batches of this size). */
export const MAX_REPLIES = 100;

/** person: a human answered. maybe_optout: a human answered in words that read like an opt-out. optout: asked to stop. */
export const REPLY_KINDS = ["person", "maybe_optout", "optout"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export type Reply = {
  source_key: string;
  sender: string;
  kind: ReplyKind;
  message_id: string;
  words: string;
  from: string | null;
  subject: string | null;
  replied_at: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  list: string | null;
  list_label: string | null;
};

/** A reply the portal could not take, by its message id when it has one, so the engine knows which to keep. */
export type Rejected = { message_id: string | null; problem: string };

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

/**
 * Checks the posted replies. A reply is refused only when it cannot be filed at all (no key, no
 * message id, an unknown kind, the same message twice). A sender who is not a rep with a login is
 * NOT a reason to refuse: the reply is still saved and the admins are still told (see planReply).
 */
export function parseReplies(body: unknown): { replies: Reply[]; rejected: Rejected[] } {
  const list = (body as { replies?: unknown } | null)?.replies;
  if (!Array.isArray(list))
    return { replies: [], rejected: [{ message_id: null, problem: "Send { replies: [...] }." }] };
  if (list.length > MAX_REPLIES)
    return {
      replies: [],
      rejected: [
        {
          message_id: null,
          problem: `At most ${MAX_REPLIES} replies per call; got ${list.length}.`,
        },
      ],
    };
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  const replies: Reply[] = [];
  list.forEach((raw, i) => {
    const r = (raw ?? {}) as Partial<Record<keyof Reply, unknown>>;
    const at = `Reply ${i + 1}`;
    const key = str(r.source_key, 200);
    const mid = str(r.message_id, 200);
    const no = (problem: string) =>
      void rejected.push({ message_id: mid, problem: `${at}: ${problem}` });
    if (!key || !mid) return no("no source_key or message_id.");
    if (seen.has(mid)) return no("the same message appears twice.");
    const kind = str(r.kind, 20) as ReplyKind | null;
    if (!kind || !REPLY_KINDS.includes(kind))
      return no(`kind should be one of ${REPLY_KINDS.join(", ")}.`);
    const when = str(r.replied_at, 25);
    seen.add(mid);
    replies.push({
      source_key: key,
      sender: (str(r.sender, 40) ?? "").toLowerCase(),
      kind,
      message_id: mid,
      words: str(r.words, 1500) ?? "",
      from: str(r.from, 200),
      subject: str(r.subject, 300),
      replied_at: when && DATE.test(when) ? when.replace(" ", "T") : null,
      name: str(r.name, 200),
      email: str(r.email, 200),
      phone: str(r.phone, 40),
      city: str(r.city, 100),
      state: str(r.state, 2)?.toUpperCase() ?? null,
      industry: str(r.industry, 60),
      list: str(r.list, 40),
      list_label: str(r.list_label, 80),
    });
  });
  return { replies, rejected };
}

type Signal = {
  source?: unknown;
  signal_type?: unknown;
  signal_date?: unknown;
  detail?: unknown;
  message_id?: unknown;
};

/** The signal that records one reply on the lead (its words show on the lead's page). */
export function replySignal(r: Reply): Signal {
  return {
    source: "email",
    signal_type: r.kind === "optout" ? "email_optout" : "email_reply",
    signal_date: r.replied_at, // the full time, so two replies on one day still sort newest first
    detail: [r.words || "(no words, only the subject)", r.from ? `from ${r.from}` : ""]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 1200),
    message_id: r.message_id,
  };
}

/**
 * The lead's signals after this reply: what was there, plus the list the lead came from (so the
 * lead type shows) and the reply itself, each once. `fresh` is false when this exact message was
 * already recorded, so a retried push neither duplicates the reply nor notifies anyone again.
 */
export function mergeSignals(existing: unknown, r: Reply): { signals: Signal[]; fresh: boolean } {
  const old = Array.isArray(existing)
    ? (existing as Signal[]).filter((s) => s && typeof s === "object")
    : [];
  if (old.some((s) => s.message_id === r.message_id)) return { signals: old, fresh: false };
  const out = [...old];
  if (r.list && !out.some((s) => s.signal_type === r.list))
    out.push({ source: "email", signal_type: r.list, signal_date: null });
  out.push(replySignal(r));
  return { signals: out, fresh: true };
}

/** The notification the owner and every admin get. `senderName` is whose email was answered. */
export function replyNote(r: Reply, senderName: string): { title: string; body: string } {
  const who = r.name || r.email || r.from || "Someone";
  const title =
    r.kind === "optout"
      ? `${who} asked Lamp to stop emailing`
      : `${who} replied to ${senderName}'s email${r.kind === "maybe_optout" ? " (reads like an opt-out)" : ""}`;
  const said = r.words ? `"${r.words}"` : "(no words, only the subject)";
  const from = [r.from ? `From ${r.from}` : "", r.list_label ?? ""].filter(Boolean).join(" · ");
  return {
    title: title.slice(0, 200),
    body: [said, from].filter(Boolean).join("\n").slice(0, 1000),
  };
}

/** Who is told: the rep who owns the reply (when there is one), then every admin, each once. */
export function recipients(ownerUser: string | null, admins: string[]): string[] {
  return [...new Set([ownerUser, ...admins].filter((x): x is string => !!x))];
}

export type Seat = { slug: string; name: string; user_id: string | null; active: boolean };
export type OldLead = {
  signals: unknown;
  rep_slug: string | null;
  phone: string | null;
  email: string | null;
} | null;

/**
 * Everything one reply changes, decided without touching the database (so it can be tested):
 * - the owner: an existing lead keeps the owner staff gave it (even "unassigned"); a new one goes to
 *   the rep who sent the email when that rep is active with a login, else to nobody (admins only);
 * - who is told: that owner, if they can sign in and are active, and every admin;
 * - the row: an opt-out is filed as do-not-call, so nobody works it as a lead; any other reply
 *   leaves the status staff set alone (a new row starts at "new").
 * Returns null when this message is already recorded: nothing to write, nobody to tell.
 */
export function planReply(old: OldLead, r: Reply, seats: Seat[], admins: string[]) {
  const { signals, fresh } = mergeSignals(old?.signals, r);
  if (!fresh) return null;
  const sender = seats.find((s) => s.slug === r.sender) ?? null;
  const owner = old ? old.rep_slug : sender && sender.active && sender.user_id ? sender.slug : null;
  const ownerSeat = seats.find((s) => s.slug === owner) ?? null;
  const tell = recipients(ownerSeat && ownerSeat.active ? ownerSeat.user_id : null, admins);
  const optout = r.kind === "optout";
  const row: Record<string, unknown> = {
    source: REPLY_SOURCE,
    source_key: r.source_key,
    name: r.name,
    email: r.email ?? old?.email ?? null,
    phone: r.phone ?? old?.phone ?? null,
    city: r.city,
    state: r.state,
    industry: r.industry,
    tier: optout ? "X" : "A",
    reason: optout
      ? "Asked Lamp to stop emailing"
      : `Replied to the Lamp email${r.list_label ? ` · ${r.list_label}` : ""}`,
    signals,
    rep_slug: owner,
    pushed_at: new Date().toISOString(), // the newest reply puts the lead at the top of the list
    ...(optout ? { status: "do_not_call" } : {}),
  };
  const senderName =
    sender?.name ?? (r.sender ? r.sender.charAt(0).toUpperCase() + r.sender.slice(1) : "Lamp");
  return { row, tell, note: replyNote(r, senderName) };
}

/** The reply records on a lead, newest first, for the Email replies list. */
export type ReplyRecord = { kind: "reply" | "optout"; date: string | null; detail: string };
export function replyRecords(signals: unknown): ReplyRecord[] {
  if (!Array.isArray(signals)) return [];
  return (signals as Signal[])
    .filter((s) => s && (s.signal_type === "email_reply" || s.signal_type === "email_optout"))
    .map((s) => ({
      kind: (s.signal_type === "email_optout" ? "optout" : "reply") as ReplyRecord["kind"],
      date: typeof s.signal_date === "string" ? s.signal_date : null,
      detail: typeof s.detail === "string" ? s.detail : "",
    }))
    .reverse() // the latest written first when two share a time
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

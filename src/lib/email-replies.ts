// Email replies (2026-11-11): when someone answers one of Lamp's outreach emails, the War Room
// engine posts the reply to /api/engine/reply with the same shared secret as the daily lead push.
// The reply lands in Staff > Email replies as an engine lead (source "email-reply") owned by the rep
// who sent the email, and that rep plus every admin gets a notification with the person's words:
// the sender handles it, the admins catch whatever the sender misses. This file is the part with
// no server or database in it, so the tests can load it.

/** The engine_leads source every email reply is filed under. */
export const REPLY_SOURCE = "email-reply";

/** One call carries at most this many replies (a reply check runs a few times a day). */
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

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

/**
 * Checks the posted replies. `senders` are the rep slugs that can own a reply (reps with a login).
 * A reply that fails is left out and named in `problems`; the rest still go in.
 */
export function parseReplies(
  body: unknown,
  senders: string[],
): { replies: Reply[]; problems: string[] } {
  const list = (body as { replies?: unknown } | null)?.replies;
  if (!Array.isArray(list)) return { replies: [], problems: ["Send { replies: [...] }."] };
  if (list.length > MAX_REPLIES)
    return {
      replies: [],
      problems: [`At most ${MAX_REPLIES} replies per call; got ${list.length}.`],
    };
  const problems: string[] = [];
  const seen = new Set<string>();
  const replies: Reply[] = [];
  list.forEach((raw, i) => {
    const r = (raw ?? {}) as Partial<Record<keyof Reply, unknown>>;
    const at = `Reply ${i + 1}`;
    const key = str(r.source_key, 200);
    const mid = str(r.message_id, 200);
    if (!key || !mid) return void problems.push(`${at}: no source_key or message_id.`);
    if (seen.has(mid)) return void problems.push(`${at}: the same message appears twice.`);
    const sender = (str(r.sender, 40) ?? "").toLowerCase();
    if (!senders.includes(sender))
      return void problems.push(
        `${at}: ${sender ? `"${sender}" is not a rep with a login` : "no sender"}.`,
      );
    const kind = str(r.kind, 20) as ReplyKind | null;
    if (!kind || !REPLY_KINDS.includes(kind))
      return void problems.push(`${at}: kind should be one of ${REPLY_KINDS.join(", ")}.`);
    const when = str(r.replied_at, 25);
    seen.add(mid);
    replies.push({
      source_key: key,
      sender,
      kind,
      message_id: mid,
      words: str(r.words, 1500) ?? "",
      from: str(r.from, 200),
      subject: str(r.subject, 300),
      replied_at: when && DATE.test(when) ? when : null,
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
  return { replies, problems };
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
    signal_date: (r.replied_at ?? "").slice(0, 10) || null,
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

/** The notification the sender and every admin get. */
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

/** Who is told: the rep who sent the email, then every admin, each once. */
export function recipients(senderUser: string | null, admins: string[]): string[] {
  return [...new Set([senderUser, ...admins].filter((x): x is string => !!x))];
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
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

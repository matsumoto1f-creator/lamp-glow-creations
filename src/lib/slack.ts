// Lamp in Slack: the wording and parsing, with no imports so the deno tests load it directly.
// The sending lives in slack.server.ts; setup is in docs/slack.md.

/** Notification kinds the team channel also hears about (the rest are only the person's DM). */
export const CHANNEL_KINDS = ["file", "offer", "funded", "started"] as const;

export type SlackNotification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  application_id: string | null;
};

/** Slack's three control characters, so a business name can't become a link or a mention. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A link back into Lamp: only paths on the site, never anything else a row might hold. */
export function lampLink(site: string, link: string | null): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//")) return null;
  return site.replace(/\/$/, "") + link;
}

/** The DM a person gets: what their Lamp bell says, with a link to open it. */
export function dmText(n: SlackNotification, site: string): string {
  const url = lampLink(site, n.link) ?? lampLink(site, "/staff");
  return [`*${esc(n.title)}*`, n.body ? esc(n.body) : null, url ? `<${url}|Open in Lamp>` : null]
    .filter(Boolean)
    .join("\n");
}

const CHANNEL_ICON: Record<string, string> = {
  file: ":page_facing_up:",
  offer: ":handshake:",
  funded: ":moneybag:",
  started: ":pencil2:",
};

/** The team channel's line for a deal event, with whose file it is. */
export function channelText(n: SlackNotification, site: string, repName: string | null): string {
  const url = lampLink(site, n.link);
  return [
    `${CHANNEL_ICON[n.kind] ?? ":bell:"} *${esc(n.title)}*${repName ? ` · ${esc(repName)}` : ""}`,
    n.body ? esc(n.body) : null,
    url ? `<${url}|Open the file>` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * One event reaches the channel once, though the database writes a notification for each person
 * who hears it (the rep and their admin): the key is the event, not the notification.
 */
export const channelKey = (n: SlackNotification) =>
  n.application_id && (CHANNEL_KINDS as readonly string[]).includes(n.kind)
    ? `${n.kind}:${n.application_id}`
    : null;

export type LampCommand = { cmd: "today" } | { cmd: "lead"; query: string } | { cmd: "help" };

/** "/lamp today", "/lamp lead ISK", "/lamp 718-555"; anything else is help. */
export function parseCommand(text: string): LampCommand {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || /^(help|\?)$/i.test(t)) return { cmd: "help" };
  if (/^(today|me|mine)$/i.test(t)) return { cmd: "today" };
  const m = /^(?:lead|find|search)\s+(.+)$/i.exec(t);
  const query = (m ? m[1]! : t).slice(0, 80).trim();
  return query.length >= 2 ? { cmd: "lead", query } : { cmd: "help" };
}

export const HELP_TEXT = [
  "*Lamp in Slack*",
  "`/lamp today`: your leads and files right now",
  "`/lamp lead ISK` or `/lamp 718-555`: find one of your leads by name or phone",
  "Only you see the answers. Alerts for your leads and files come here as DMs.",
].join("\n");

/** What Slack signs: "v0:<timestamp>:<raw body>". */
export const signatureBase = (timestamp: string, body: string) => `v0:${timestamp}:${body}`;

/** Slack's timestamp is within five minutes of now (older requests could be replays). */
export function freshTimestamp(timestamp: string, nowMs = Date.now()): boolean {
  const ts = Number(timestamp);
  return Number.isInteger(ts) && Math.abs(nowMs / 1000 - ts) <= 300;
}

const STATUS_WORD: Record<string, string> = {
  new: "new",
  called: "called",
  no_answer: "no answer",
  callback: "callback",
  qualified: "qualified",
  submitted: "submitted",
  funded: "funded",
  dead: "dead",
  do_not_call: "do not call",
};

/** "/lamp today": how many leads in each status, and files by stage. */
export function todayText(
  name: string,
  leads: Record<string, number>,
  files: Record<string, number>,
  site: string,
): string {
  const line = (m: Record<string, number>, words: Record<string, string> = {}) =>
    Object.entries(m)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${words[k] ?? k.replace(/_/g, " ")}`)
      .join(", ") || "none";
  return [
    `*${esc(name)}, here's where you stand*`,
    `Engine leads: ${line(leads, STATUS_WORD)}`,
    `Files: ${line(files)}`,
    `<${site.replace(/\/$/, "")}/staff|Open Lamp>`,
  ].join("\n");
}

export type LeadHit = {
  name: string | null;
  phone: string | null;
  contact_phone: string | null;
  status: string;
  owner: string | null;
  city: string | null;
  state: string | null;
};

/** "/lamp lead ...": up to five leads, one line each, with who to ask for. */
export function leadsText(query: string, hits: LeadHit[], more: boolean): string {
  if (!hits.length) return `No leads of yours match "${esc(query)}".`;
  const lines = hits.map((h) => {
    const where = [h.city, h.state].filter(Boolean).join(", ");
    const parts = [
      `*${esc(h.name || "Unnamed business")}*${where ? ` (${esc(where)})` : ""}`,
      h.owner ? `ask for ${esc(h.owner)}` : null,
      h.phone ? esc(h.phone) : null,
      h.contact_phone ? `best ${esc(h.contact_phone)}` : null,
      STATUS_WORD[h.status] ?? h.status,
    ].filter(Boolean);
    return `• ${parts.join(" · ")}`;
  });
  return [...lines, more ? "_More match; add a word to narrow it._" : null]
    .filter(Boolean)
    .join("\n");
}

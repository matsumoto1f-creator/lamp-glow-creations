// The merchant email nudge (supabase/migrations/20261110140000_chat_merchant.sql).
//
//   POST /api/chat/nudge   called every 5 minutes by the database (chat_nudge_tick() through pg_cron,
//                          20261110150000_chat_nudge_schedule.sql) or any scheduler holding the nudge
//                          secret (x-chat-nudge-secret; the Vault's chat_nudge_secret). Emails each
//                          merchant whose Lamp reply has waited 15 minutes unread, at most once every
//                          4 hours per conversation, from the Lamp mailbox in the name the application
//                          emails use. A link to their account, never the message.
// Nothing is sent until the Lamp mailbox is connected (Funders page): the route answers 200 and says
// so. Never import this file from browser code: the route file loads it inside its handler.
import {
  gmailAccessToken,
  json,
  SERVICE_KEY,
  service,
  SITE_URL,
  SUPABASE_URL,
} from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import { gmailSend } from "@/lib/application-links.server";
import { nudgeEmail } from "@/lib/chat";

type Svc = ReturnType<typeof service>;
type Due = {
  thread_id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  rep_slug: string | null;
};
type RepRow = { slug: string; name: string; admin_slug: string | null; active: boolean };

let cached: { value: string; at: number } | null = null;

/** The nudge secret, read from the database's Vault (cached for ten minutes). */
async function nudgeSecret(svc: Svc): Promise<string> {
  if (cached && Date.now() - cached.at < 600_000) return cached.value;
  const r = await svc.rpc("chat_nudge_secret" as never);
  const value = typeof r.data === "string" ? r.data : "";
  if (value) cached = { value, at: Date.now() };
  return value;
}

/** The name the merchant knows: the rep's team lead when there is an active one, else the rep. */
function facingName(slug: string | null, reps: Map<string, RepRow>): string {
  const rep = slug ? reps.get(slug) : undefined;
  if (!rep) return "Your Lamp rep";
  const lead = rep.admin_slug ? reps.get(rep.admin_slug) : undefined;
  return (lead?.active ? lead.name : rep.name) || "Your Lamp rep";
}

export async function chatNudge(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY()) return json(500, { error: "No database settings." });
  const svc = service();
  const expected = await nudgeSecret(svc);
  if (!expected || !sameSecret(request.headers.get("x-chat-nudge-secret") ?? "", expected))
    return json(401, { error: "Not the database." });

  const due = await svc.rpc("chat_nudges_due" as never);
  if (due.error) return json(503, { error: "Couldn't read who is due a nudge." });
  const rows = (due.data ?? []) as Due[];
  if (!rows.length) return json(200, { due: 0, sent: 0 });

  const access = await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
  if ("error" in access) return json(200, { due: rows.length, sent: 0, skipped: access.error });

  const r = await svc.from("reps").select("slug,name,admin_slug,active");
  const reps = new Map(((r.data ?? []) as RepRow[]).map((x) => [x.slug, x]));

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const contact = facingName(row.rep_slug, reps);
    const mail = nudgeEmail({ firstName: row.first_name, contact, site: SITE_URL() });
    const out = await gmailSend(access.access, {
      to: row.email,
      fromName: contact === "Your Lamp rep" ? "Lamp" : `${contact} at Lamp`,
      replyTo: null,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if ("error" in out) {
      failed++;
      continue;
    }
    await svc.rpc(
      "chat_mark_nudged" as never,
      { _thread: row.thread_id, _user: row.user_id } as never,
    );
    sent++;
  }
  return json(200, { due: rows.length, sent, failed });
}

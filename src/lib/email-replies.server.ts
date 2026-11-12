// Server side of POST /api/engine/reply (see email-replies.ts). Reads from the server environment:
//   ENGINE_PUSH_SECRET   the same shared secret the War Room engine sends for the daily lead push
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
//
// Never import this file from browser code: the route file loads it inside its handlers.
import { env, json, SERVICE_KEY, service, SUPABASE_URL } from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import { parseReplies, planReply, REPLY_SOURCE, type Seat } from "@/lib/email-replies";

const allowed = (request: Request) =>
  sameSecret(request.headers.get("x-engine-push-secret") ?? "", env("ENGINE_PUSH_SECRET"));

/**
 * POST /api/engine/reply { replies: [...], dry_run?: boolean }
 * Each reply becomes (or updates) one engine lead under source "email-reply" (see planReply for who
 * owns it, who is told and what changes). For each reply the notifications are written FIRST, then
 * the lead: if the lead write fails the engine retries and someone may be told twice, but nobody is
 * ever left untold. A reply already recorded (same message) changes nothing and tells no one.
 * The answer names every message by id: `saved`, `already_recorded` and `rejected`, so the engine
 * keeps exactly the ones it must send again.
 */
export async function saveReplies(request: Request): Promise<Response> {
  if (!env("ENGINE_PUSH_SECRET")) return json(503, { error: "Engine push is not set up." });
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  if (!allowed(request)) return json(401, { error: "Not allowed." });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const { replies, rejected } = parseReplies(body);
  const dry = (body as { dry_run?: boolean } | null)?.dry_run === true;
  if (dry || replies.length === 0)
    return json(200, {
      saved: [],
      already_recorded: [],
      rejected,
      would_save: replies.length,
      dry_run: dry,
    });

  const db = service();
  const [reps, adminRows] = await Promise.all([
    db.from("reps").select("slug,name,user_id,active"),
    db.from("user_roles").select("user_id").eq("role", "admin"),
  ]);
  if (reps.error || adminRows.error)
    return json(500, { error: (reps.error ?? adminRows.error)!.message });
  const seats = (reps.data ?? []) as Seat[];
  const admins = ((adminRows.data ?? []) as { user_id: string }[]).map((r) => r.user_id);

  const saved: string[] = [];
  const recorded: string[] = [];
  const stop = (error: string) => json(500, { saved, already_recorded: recorded, rejected, error });
  for (const r of replies) {
    const old = await db
      .from("engine_leads")
      .select("signals,rep_slug,phone,email")
      .eq("source", REPLY_SOURCE)
      .eq("source_key", r.source_key)
      .maybeSingle();
    if (old.error) return stop(old.error.message);
    const plan = planReply(old.data, r, seats, admins);
    if (!plan) {
      recorded.push(r.message_id);
      continue;
    }
    if (plan.tell.length) {
      const told = await db.from("notifications").insert(
        plan.tell.map((user_id) => ({
          user_id,
          kind: "assigned",
          ...plan.note,
          link: "/staff?view=replies",
        })),
      );
      if (told.error) return stop(told.error.message);
    }
    const up = await db.from("engine_leads").upsert(plan.row, { onConflict: "source,source_key" });
    if (up.error) return stop(up.error.message);
    saved.push(r.message_id);
  }
  return json(200, { saved, already_recorded: recorded, rejected });
}

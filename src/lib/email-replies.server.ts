// Server side of POST /api/engine/reply (see email-replies.ts). Reads from the server environment:
//   ENGINE_PUSH_SECRET   the same shared secret the War Room engine sends for the daily lead push
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
//
// Never import this file from browser code: the route file loads it inside its handlers.
import { env, json, SERVICE_KEY, service, SUPABASE_URL } from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import {
  mergeSignals,
  parseReplies,
  recipients,
  REPLY_SOURCE,
  replyNote,
} from "@/lib/email-replies";

const allowed = (request: Request) =>
  sameSecret(request.headers.get("x-engine-push-secret") ?? "", env("ENGINE_PUSH_SECRET"));

/**
 * POST /api/engine/reply { replies: [...], dry_run?: boolean }
 * Each reply becomes (or updates) one engine lead under source "email-reply", owned by the rep who
 * sent the email unless staff already reassigned it; what staff recorded on it (status, notes)
 * stays. The sender and every admin get one notification per new reply. A reply already recorded
 * (same message) changes nothing and notifies no one, so the engine can safely send it again.
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
  const db = service();
  const [reps, adminRows] = await Promise.all([
    db.from("reps").select("slug,name,user_id"),
    db.from("user_roles").select("user_id").eq("role", "admin"),
  ]);
  if (reps.error || adminRows.error)
    return json(500, { error: (reps.error ?? adminRows.error)!.message });
  const seats = (
    (reps.data ?? []) as { slug: string; name: string; user_id: string | null }[]
  ).filter((r) => !!r.user_id);
  const admins = ((adminRows.data ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const { replies, problems } = parseReplies(
    body,
    seats.map((s) => s.slug),
  );
  const dry = (body as { dry_run?: boolean } | null)?.dry_run === true;
  if (dry || replies.length === 0)
    return json(200, { saved: 0, would_save: replies.length, problems, dry_run: dry });

  let saved = 0;
  let skipped = 0;
  const notes: { user_id: string; kind: string; title: string; body: string; link: string }[] = [];
  for (const r of replies) {
    const old = await db
      .from("engine_leads")
      .select("signals,rep_slug,phone,email")
      .eq("source", REPLY_SOURCE)
      .eq("source_key", r.source_key)
      .maybeSingle();
    if (old.error) return json(500, { saved, error: old.error.message, problems });
    const { signals, fresh } = mergeSignals(old.data?.signals, r);
    if (!fresh) {
      skipped++;
      continue;
    }
    const seat = seats.find((s) => s.slug === r.sender)!;
    const row = {
      source: REPLY_SOURCE,
      source_key: r.source_key,
      name: r.name,
      email: r.email ?? old.data?.email ?? null,
      phone: r.phone ?? old.data?.phone ?? null,
      city: r.city,
      state: r.state,
      industry: r.industry,
      tier: "A",
      reason: `Replied to the Lamp email${r.list_label ? ` · ${r.list_label}` : ""}`,
      signals,
      rep_slug: old.data?.rep_slug ?? r.sender, // staff may have handed it on: that stays
    };
    const up = await db.from("engine_leads").upsert(row, { onConflict: "source,source_key" });
    if (up.error) return json(500, { saved, error: up.error.message, problems });
    saved++;
    const n = replyNote(r, seat.name);
    for (const user_id of recipients(seat.user_id, admins))
      notes.push({ user_id, kind: "assigned", ...n, link: "/staff?view=replies" });
  }
  if (notes.length) await db.from("notifications").insert(notes); // a missed note doesn't undo the reply
  return json(200, { saved, already_recorded: skipped, notified: notes.length, problems });
}

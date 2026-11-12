// Server side of the engine's daily hand-out (see engine-push.ts). Reads from the server environment:
//   ENGINE_PUSH_SECRET   the shared secret the War Room engine sends as x-engine-push-secret
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
//
// Never import this file from browser code: the route file loads it inside its handlers.
import { env, json, SERVICE_KEY, service, SUPABASE_URL } from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import { parsePush, perRep } from "@/lib/engine-push";

const allowed = (request: Request) =>
  sameSecret(request.headers.get("x-engine-push-secret") ?? "", env("ENGINE_PUSH_SECRET"));

function ready(): Response | null {
  if (!env("ENGINE_PUSH_SECRET")) return json(503, { error: "Engine push is not set up." });
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  return null;
}

/** Reps who can take leads: active, with a login. `fresh` is how many untouched leads each holds. */
async function takers(db: ReturnType<typeof service>) {
  const reps = await db.from("reps").select("slug,name,user_id").eq("active", true);
  if (reps.error) throw new Error(reps.error.message);
  const out = [];
  for (const r of reps.data ?? []) {
    if (!r.user_id) continue;
    const c = await db
      .from("engine_leads")
      .select("id", { count: "exact", head: true })
      .eq("rep_slug", r.slug)
      .eq("status", "new")
      .neq("source", "email-reply"); // a reply to an email is not a lead the push handed out: it does not use up the rep's daily room
    if (c.error) throw new Error(c.error.message);
    out.push({
      slug: r.slug as string,
      name: r.name as string,
      user_id: r.user_id as string,
      fresh: c.count ?? 0,
    });
  }
  return out;
}

/** GET /api/engine/push: who can take leads today and how many untouched leads each already has. */
export async function pushStatus(request: Request): Promise<Response> {
  const bad = ready();
  if (bad) return bad;
  if (!allowed(request)) return json(401, { error: "Not allowed." });
  try {
    const reps = await takers(service());
    return json(200, { reps: reps.map(({ slug, name, fresh }) => ({ slug, name, fresh })) });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
}

/**
 * POST /api/engine/push { leads: [...], dry_run?: boolean }
 * Upserts by (source, source_key) like the admin's Upload: a lead already in Lamp is only
 * reassigned, and what a rep recorded on it stays. Each rep gets one notification for the batch.
 */
export async function pushLeads(request: Request): Promise<Response> {
  const bad = ready();
  if (bad) return bad;
  if (!allowed(request)) return json(401, { error: "Not allowed." });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const db = service();
  let reps;
  try {
    reps = await takers(db);
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
  const { leads, problems } = parsePush(
    body,
    reps.map((r) => r.slug),
  );
  const counts = perRep(leads);
  const dry = (body as { dry_run?: boolean } | null)?.dry_run === true;
  if (dry || leads.length === 0)
    return json(200, { pushed: 0, would_push: counts, problems, dry_run: dry });

  let done = 0;
  for (let i = 0; i < leads.length; i += 200) {
    const chunk = leads.slice(i, i + 200);
    const { error } = await db
      .from("engine_leads")
      .upsert(chunk, { onConflict: "source,source_key" });
    if (error) return json(500, { pushed: done, error: error.message, problems });
    done += chunk.length;
  }
  const notes = reps
    .filter((r) => counts[r.slug])
    .map((r) => ({
      user_id: r.user_id,
      kind: "assigned",
      title: `${counts[r.slug]} new lead${counts[r.slug] === 1 ? "" : "s"} for today`,
      body: "Today's leads from the engine are in Engine leads, best first.",
      link: "/staff?view=engine",
    }));
  if (notes.length) await db.from("notifications").insert(notes); // a missed note doesn't undo the leads
  return json(200, { pushed: done, per_rep: counts, problems });
}

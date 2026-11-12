// Server side of /api/engine/status (see engine-status.ts). Reads from the server environment:
//   ENGINE_PUSH_SECRET   the same shared secret the War Room engine sends for the lead push and replies
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
// The engine_status table is closed to everyone but this server (service role), like brain_briefs.
//
// Never import this file from browser code: the route file loads it inside its handlers.
import { caller, env, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import { staff } from "@/lib/brain.server";
import { MAX_BYTES, parseStatus, type Snapshot } from "@/lib/engine-status";

/** POST /api/engine/status { snapshot } from the engine, with the shared secret: replaces that engine's row. */
export async function saveStatus(request: Request): Promise<Response> {
  if (!env("ENGINE_PUSH_SECRET")) return json(503, { error: "Engine push is not set up." });
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  if (!sameSecret(request.headers.get("x-engine-push-secret") ?? "", env("ENGINE_PUSH_SECRET")))
    return json(401, { error: "Not allowed." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES * 4)
    return json(413, { error: "The snapshot is too big." });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const parsed = parseStatus(body);
  if ("problem" in parsed) return json(400, { error: parsed.problem });
  const { snapshot } = parsed;
  const up = await service()
    .from("engine_status")
    .upsert(
      { key: snapshot.key, snapshot, received_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (up.error) return json(500, { error: up.error.message });
  return json(200, { ok: true, key: snapshot.key });
}

export type EngineStatus = { snapshot: Snapshot | null; received_at: string | null };

/** GET /api/engine/status (admins only, signed in): the latest snapshot, or none yet. Changes nothing. */
export async function readStatus(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const me = await staff(who.userId);
  if (!me?.isAdmin) return json(403, { error: "The email engine page is for Lamp's admins." });
  const r = await service()
    .from("engine_status")
    .select("snapshot,received_at")
    .eq("key", "lamp-email")
    .maybeSingle();
  if (r.error) return json(500, { error: r.error.message });
  const row = r.data as { snapshot: Snapshot; received_at: string } | null;
  const out: EngineStatus = {
    snapshot: row?.snapshot ?? null,
    received_at: row?.received_at ?? null,
  };
  return json(200, out);
}

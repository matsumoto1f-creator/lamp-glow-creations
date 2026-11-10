// Lamp's Anthropic key: where the server gets it, and POST /api/ai/key (admins only) to save or
// remove one from Staff > AI activity (migration 20261111120000_ai_key.sql). Never import this
// from browser code: the route file loads it inside its handler.
//
// Order: ANTHROPIC_API_KEY in the server's secrets wins; otherwise the key an admin saved, which
// lives in the database's Vault and is read through ai_key() by the service role only.
//
// The key is never sent back to a browser, never logged, and never stored anywhere but the Vault.
// Before a pasted key is saved it is tested against Anthropic with a call that costs nothing
// (listing models), so a wrong key is refused on the spot instead of failing later on a file.

import Anthropic from "@anthropic-ai/sdk";
import { caller, env, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import { readJson } from "@/lib/application-links.server";
import { staff } from "@/lib/brain.server";
import { type KeyInfo, type KeySource, keyProblem, tidyKey } from "@/lib/ai-key";

const CACHE_MS = 60_000; // a removed key stops being used within a minute on every server
let cached: { at: number; key: string } | null = null;

/** The key an admin saved, or "" when there is none. Cached briefly. */
async function savedKey(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.key;
  if (!SUPABASE_URL() || !SERVICE_KEY()) return "";
  const r = await service().rpc("ai_key" as never);
  // on an error (the function isn't there yet, the database is busy) say "none" and don't cache
  if (r.error) return "";
  const key = typeof r.data === "string" ? r.data.trim() : "";
  cached = { at: Date.now(), key };
  return key;
}

/** The key Lamp uses for Claude and where it came from. */
export async function anthropicKey(): Promise<{ key: string; source: KeySource }> {
  const fromEnv = env("ANTHROPIC_API_KEY");
  if (fromEnv) return { key: fromEnv, source: "secrets" };
  const saved = await savedKey();
  return saved ? { key: saved, source: "saved" } : { key: "", source: null };
}

/** What the page shows about the key. Never the key. */
export async function keyInfo(): Promise<KeyInfo> {
  const { source } = await anthropicKey();
  const r = await service().rpc("ai_key_info" as never);
  const row = (Array.isArray(r.data) ? r.data[0] : r.data) as
    { is_set?: boolean; saved_by?: string | null; saved_at?: string | null } | null | undefined;
  return {
    source,
    saved: !r.error && !!row?.is_set,
    saved_by: (!r.error && row?.saved_by) || null,
    saved_at: (!r.error && row?.saved_at) || null,
  };
}

/** Asks Anthropic whether the key works. Free: it only lists models. */
async function test(key: string): Promise<string | null> {
  try {
    const client = new Anthropic({ apiKey: key, timeout: 15_000, maxRetries: 0 });
    await client.models.list({ limit: 1 });
    return null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError)
      return "Anthropic refused that key. Check it was copied whole, or make a new one.";
    if (e instanceof Anthropic.PermissionDeniedError)
      return "Anthropic says that key isn't allowed to be used. Check the key's workspace.";
    if (e instanceof Anthropic.RateLimitError) return "Anthropic is busy. Try again in a minute.";
    return "Couldn't reach Anthropic to test the key. Nothing was saved; try again.";
  }
}

type Body = { action?: string; key?: unknown };

export async function aiKeyAction(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const me = await staff(who.userId);
  if (!me?.isAdmin) return json(403, { error: "Only Lamp's admins can change the Anthropic key." });
  const body = await readJson<Body>(request, 2048);
  if (body instanceof Response) return body;
  const svc = service();

  if (body.action === "remove") {
    const r = await svc.rpc("ai_key_clear" as never);
    if (r.error) return json(503, { error: "Couldn't remove the key. Try again in a minute." });
    cached = null;
    return json(200, { key: await keyInfo() });
  }

  if (body.action === "set") {
    const problem = keyProblem(body.key);
    if (problem) return json(400, { error: problem });
    const key = tidyKey(body.key);
    const refused = await test(key);
    if (refused) return json(400, { error: refused });
    const r = await svc.rpc(
      "ai_key_set" as never,
      { _key: key, _by: me.name ?? "an admin" } as never,
    );
    if (r.error)
      return json(503, {
        error: "The key works, but it couldn't be saved. Try again in a minute.",
      });
    cached = null;
    return json(200, { key: await keyInfo() });
  }

  return json(400, { error: "Unknown action." });
}

// Lamp in Discord, server side (setup: docs/discord.md). Reads from the server environment:
//   DISCORD_BOT_TOKEN       the Lamp app's bot token (Developer Portal, Bot, Reset Token)
//   DISCORD_PUBLIC_KEY      the app's public key (General Information), checks /lamp requests
//   DISCORD_DEALS_CHANNEL   the #deals channel id: the bot posts there itself (not a secret)
//   DISCORD_DEALS_WEBHOOK   or instead the #deals webhook URL (Edit Channel, Integrations); optional
//   ENGINE_PUSH_SECRET      reused to guard /api/discord/setup (the War Room engine already has it)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
//
// Routes:
//   /api/team/relay            the database calls it for each new notification (trigger in
//                              20261105160000_discord.sql) with a secret that never leaves the
//                              database and this server: the person gets it as a Discord DM (once
//                              they've linked), and deal events also go to #deals, once each.
//   /api/discord/interactions  Discord calls it for /lamp, signed with the app's key. Answers are
//                              only for whoever asked, about their own leads and files.
//   /api/discord/link          a signed-in Lamp user finishes /lamp link: their Discord id goes on
//                              their profile, so their alerts can find them.
//   /api/discord/setup         registers /lamp with Discord, once, after the bot token is set.
// Nothing is sent while DISCORD_BOT_TOKEN is unset: the relay answers 200 and does nothing.
//
// Never import this file from browser code: the route files load it inside their handlers.
import {
  caller,
  env,
  json,
  SERVICE_KEY,
  service,
  SITE_URL,
  SUPABASE_URL,
} from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import { searchFilter, splitWhy } from "@/lib/engine-leads";
import {
  channelKey,
  channelText,
  dmText,
  HELP_TEXT,
  isDiscordId,
  LAMP_COMMAND,
  leadsText,
  linkPayload,
  parseCommand,
  readLinkToken,
  todayText,
  type TeamNotification,
} from "@/lib/team-alerts";

const API = () => (env("DISCORD_API_URL") || "https://discord.com/api/v10").replace(/\/$/, "");
const LINK_TTL_MS = 30 * 60 * 1000;
type Svc = ReturnType<typeof service>;

/** One Discord API call as the bot. Never throws: a failure comes back as { ok: false }. */
async function discord(method: "GET" | "POST" | "PUT", path: string, body?: unknown) {
  try {
    const res = await fetch(`${API()}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://getlamp.app, 1)",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: e instanceof Error ? e.message : "network" } };
  }
}

const NO_PINGS = { parse: [] as string[] };

// ---------- shared secret (the database's Vault) ----------

let teamSecret: { value: string; at: number } | null = null;

/** The relay secret, read from the database's Vault (cached for ten minutes). */
async function vaultSecret(svc: Svc): Promise<string> {
  if (teamSecret && Date.now() - teamSecret.at < 600_000) return teamSecret.value;
  const r = await svc.rpc("team_relay_secret" as never);
  const value = typeof r.data === "string" ? r.data : "";
  if (value) teamSecret = { value, at: Date.now() };
  return value;
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

// ---------- the relay ----------

export async function teamRelay(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY()) return json(500, { error: "No database settings." });
  const svc = service();
  const expected = await vaultSecret(svc);
  if (!expected || !sameSecret(request.headers.get("x-team-relay-secret") ?? "", expected))
    return json(401, { error: "Not the database." });
  if (!env("DISCORD_BOT_TOKEN")) return json(200, { skipped: "Discord is not set up." });

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "number" ? body.id : Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Send the notification id." });

  // the row, not the payload: the trigger sends only the id
  const r = await svc
    .from("notifications")
    .select("id,user_id,kind,title,body,link,application_id")
    .eq("id", id)
    .maybeSingle();
  if (r.error) return json(503, { error: "Couldn't read the notification." });
  const n = r.data as (TeamNotification & { user_id: string }) | null;
  if (!n) return json(404, { error: "No such notification." });

  const site = SITE_URL();
  const out: Record<string, unknown> = {};

  // the person's DM, once they've connected Discord with /lamp link
  const p = await svc.from("profiles").select("discord_id").eq("id", n.user_id).maybeSingle();
  const discordId = (p.data as { discord_id: string | null } | null)?.discord_id ?? null;
  if (isDiscordId(discordId)) {
    const dm = await discord("POST", "/users/@me/channels", { recipient_id: discordId });
    const channel = typeof dm.data["id"] === "string" ? dm.data["id"] : null;
    const sent = channel
      ? await discord("POST", `/channels/${channel}/messages`, {
          content: dmText(n, site),
          allowed_mentions: NO_PINGS,
        })
      : dm;
    out["dm"] = sent.ok ? "sent" : `failed ${sent.status}`;
  } else out["dm"] = "not linked";

  // deal events to #deals, once per event though the rep and their admin both hear it
  const key = channelKey(n);
  // the bot posts to the channel by id; a webhook URL also works if one is set instead
  const dealsChannel = env("DISCORD_DEALS_CHANNEL");
  const hook = env("DISCORD_DEALS_WEBHOOK");
  const viaBot = isDiscordId(dealsChannel);
  if (key && (viaBot || /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook))) {
    const claim = await svc
      .from("team_channel_posts" as never)
      .upsert({ key } as never, { onConflict: "key", ignoreDuplicates: true })
      .select("key");
    if (!claim.error && (claim.data ?? []).length) {
      let repName: string | null = null;
      const a = await svc
        .from("applications")
        .select("rep_slug")
        .eq("id", n.application_id!)
        .maybeSingle();
      const slug = (a.data as { rep_slug: string | null } | null)?.rep_slug;
      if (slug) {
        const rep = await svc.from("reps").select("name").eq("slug", slug).maybeSingle();
        repName = (rep.data as { name: string } | null)?.name ?? null;
      }
      const content = channelText(n, site, repName);
      if (viaBot) {
        const sent = await discord("POST", `/channels/${dealsChannel}/messages`, {
          content,
          allowed_mentions: NO_PINGS,
        });
        out["channel"] = sent.ok ? "posted" : `failed ${sent.status}`;
      } else {
        try {
          const res = await fetch(hook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "Lamp", content, allowed_mentions: NO_PINGS }),
          });
          out["channel"] = res.ok ? "posted" : `failed ${res.status}`;
        } catch {
          out["channel"] = "failed";
        }
      }
    } else out["channel"] = claim.error ? "couldn't claim" : "already posted";
  }
  return json(200, out);
}

// ---------- /lamp ----------

const hexBytes = (hex: string) =>
  /^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0
    ? new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)))
    : null;

/** Discord signed this request with the app's key (Ed25519 over timestamp + body). */
async function signedByDiscord(request: Request, raw: string): Promise<boolean> {
  const key = hexBytes(env("DISCORD_PUBLIC_KEY"));
  const sig = hexBytes(request.headers.get("x-signature-ed25519") ?? "");
  const ts = request.headers.get("x-signature-timestamp") ?? "";
  if (!key || key.length !== 32 || !sig || sig.length !== 64 || !/^\d+$/.test(ts)) return false;
  // older than five minutes could be a replay
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const pub = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", pub, sig, new TextEncoder().encode(ts + raw));
  } catch {
    return false;
  }
}

const say = (content: string) =>
  new Response(
    JSON.stringify({ type: 4, data: { content, flags: 64, allowed_mentions: NO_PINGS } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

export async function discordInteractions(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 16384) return new Response("Too big", { status: 413 });
  if (!(await signedByDiscord(request, raw))) return new Response("Bad signature", { status: 401 });
  let body: {
    type?: number;
    data?: { name?: string; options?: unknown };
    member?: { user?: { id?: string } };
    user?: { id?: string };
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  // Discord checks the endpoint with a PING when it's saved
  if (body.type === 1)
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  if (body.type !== 2 || body.data?.name !== "lamp") return say(HELP_TEXT);
  if (!SUPABASE_URL() || !SERVICE_KEY()) return say("Lamp isn't connected yet. Ask Asad.");

  const command = parseCommand(body.data.options);
  if (command.cmd === "help") return say(HELP_TEXT);
  const discordId = body.member?.user?.id ?? body.user?.id ?? "";
  if (!isDiscordId(discordId)) return say("I couldn't tell who you are in Discord.");
  const svc = service();
  const site = SITE_URL();

  if (command.cmd === "link") {
    const secret = await vaultSecret(svc);
    if (!secret) return say("Linking isn't set up yet. Ask Asad.");
    const payload = linkPayload(discordId, Date.now() + LINK_TTL_MS);
    const token = `${payload}.${await hmac(secret, payload)}`;
    return say(
      `Open this while you're signed in to Lamp to connect your Discord (it works for 30 minutes, and only for you):\n<${site}/discord-link?t=${token}>`,
    );
  }

  // who's asking: the Lamp login that linked this Discord account
  const prof = await svc.from("profiles").select("id").eq("discord_id", discordId).maybeSingle();
  const userId = (prof.data as { id: string } | null)?.id;
  if (!userId) return say("Your Discord isn't connected to Lamp yet. Type `/lamp link` first.");
  const [rep, roles] = await Promise.all([
    svc.from("reps").select("slug,name").eq("user_id", userId).maybeSingle(),
    svc.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const me = rep.data as { slug: string; name: string } | null;
  const isAdmin = ((roles.data ?? []) as { role: string }[]).some((r) => r.role === "admin");
  if (!me && !isAdmin) return say("Your Lamp login isn't a rep, so there's nothing to show.");

  if (command.cmd === "today") {
    if (!me) return say("You're an admin without a rep seat: open Lamp for the whole team.");
    const [leads, files] = await Promise.all([
      svc.from("engine_leads").select("status").eq("rep_slug", me.slug).limit(5000),
      svc.from("applications").select("status").eq("rep_slug", me.slug).limit(5000),
    ]);
    const tally = (rows: { status: string }[] | null) =>
      (rows ?? []).reduce<Record<string, number>>(
        (m, r) => ({ ...m, [String(r.status)]: (m[String(r.status)] ?? 0) + 1 }),
        {},
      );
    return say(
      todayText(
        me.name,
        tally(leads.data as { status: string }[] | null),
        tally(files.data as { status: string }[] | null),
        site,
      ),
    );
  }

  // lead search: their own leads (an admin's search covers everyone's)
  const match = searchFilter(command.query);
  if (!match) return say(HELP_TEXT);
  let q = svc
    .from("engine_leads")
    .select("name,phone,contact_phone,status,reason,contact_name,city,state")
    .order("need", { ascending: false, nullsFirst: false })
    .limit(6);
  if (!isAdmin && me) q = q.eq("rep_slug", me.slug);
  const found = await q.or(match);
  if (found.error) return say("Couldn't search right now. Try again in a moment.");
  const rows = (found.data ?? []) as {
    name: string | null;
    phone: string | null;
    contact_phone: string | null;
    status: string;
    reason: string | null;
    contact_name: string | null;
    city: string | null;
    state: string | null;
  }[];
  return say(
    leadsText(
      command.query,
      rows.slice(0, 5).map((r) => ({
        name: r.name,
        phone: r.phone,
        contact_phone: r.contact_phone,
        status: r.status,
        owner: r.contact_name || splitWhy(r.reason).owner,
        city: r.city,
        state: r.state,
      })),
      rows.length > 5,
    ),
  );
}

// ---------- /lamp link, finished in Lamp ----------

export async function discordLink(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY()) return json(500, { error: "No database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in to Lamp first, then open the link again." });
  const roles = await who.client.from("user_roles").select("role").eq("user_id", who.userId);
  const held = new Set(((roles.data ?? []) as { role: string }[]).map((r) => r.role));
  if (!held.has("admin") && !held.has("rep"))
    return json(403, { error: "Only Lamp staff connect Discord." });
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const t = readLinkToken(body?.token);
  if (!t) return json(400, { error: "That link expired or isn't whole. Type /lamp link again." });
  const svc = service();
  const secret = await vaultSecret(svc);
  if (!secret || !sameSecret(t.sig, await hmac(secret, linkPayload(t.discordId, t.expires))))
    return json(400, { error: "That link isn't one Lamp made. Type /lamp link again." });
  // one Lamp login per Discord account: it moves to whoever links it last
  const clear = await svc
    .from("profiles")
    .update({ discord_id: null } as never)
    .eq("discord_id", t.discordId)
    .neq("id", who.userId);
  if (clear.error) return json(500, { error: "Couldn't connect. Try again." });
  const set = await svc
    .from("profiles")
    .update({ discord_id: t.discordId } as never)
    .eq("id", who.userId)
    .select("id");
  if (set.error || !(set.data ?? []).length) return json(500, { error: "Couldn't connect." });
  return json(200, { linked: true });
}

// ---------- registering /lamp, once ----------

/** Whether the stored token is shaped like a bot token, and whose: no part of its value. */
function tokenShape(token: string) {
  const parts = token.split(".");
  let appId: string | null = null;
  try {
    const id = atob((parts[0] ?? "").replace(/-/g, "+").replace(/_/g, "/"));
    appId = /^\d{17,20}$/.test(id) ? id : null;
  } catch {
    appId = null;
  }
  return {
    length: token.length,
    parts: parts.length,
    first_part_is_an_app_id: appId !== null,
    app_id: appId,
    starts_with_bot_word: /^bot\s/i.test(token),
  };
}

export async function discordSetup(request: Request): Promise<Response> {
  if (
    !env("ENGINE_PUSH_SECRET") ||
    !sameSecret(request.headers.get("x-engine-push-secret") ?? "", env("ENGINE_PUSH_SECRET"))
  )
    return json(401, { error: "Not allowed." });
  if (!env("DISCORD_BOT_TOKEN")) return json(412, { error: "DISCORD_BOT_TOKEN isn't set." });
  const me = await discord("GET", "/oauth2/applications/@me");
  const appId = typeof me.data["id"] === "string" ? me.data["id"] : null;
  if (!me.ok || !appId)
    return json(502, {
      error: `Discord said ${me.status} for the app.`,
      // what the stored token looks like, never its value: a bot token has three parts and its
      // first part is the app's id in base64; a client secret or public key has one
      token_shape: tokenShape(env("DISCORD_BOT_TOKEN")),
    });
  const reg = await discord("PUT", `/applications/${appId}/commands`, [LAMP_COMMAND]);
  if (!reg.ok) return json(502, { error: `Discord said ${reg.status} registering /lamp.` });
  return json(200, {
    registered: "/lamp",
    app_id: appId,
    public_key_set: !!env("DISCORD_PUBLIC_KEY"),
    deals_channel_set: isDiscordId(env("DISCORD_DEALS_CHANNEL")),
    deals_webhook_set: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(
      env("DISCORD_DEALS_WEBHOOK"),
    ),
  });
}

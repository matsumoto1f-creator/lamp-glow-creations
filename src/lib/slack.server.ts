// Lamp in Slack, server side (setup: docs/slack.md). Reads from the server environment:
//   SLACK_BOT_TOKEN        the Lamp app's bot token (xoxb-...), from the app's OAuth page
//   SLACK_SIGNING_SECRET   the app's signing secret, from its Basic Information page
//   SLACK_DEALS_CHANNEL    the channel id deal alerts go to (C...), optional
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
//
// Two routes:
//   /api/slack/relay     the database calls it for each new notification (trigger in
//                        20261105150000_slack_relay.sql) with a secret that never leaves the
//                        database and this server; the person gets the notification as a Slack DM,
//                        and deal events also go to the team channel, once each.
//   /api/slack/command   Slack calls it for /lamp; the answer is only for whoever asked, and only
//                        about their own leads and files (admins: everyone's).
// Nothing is sent while SLACK_BOT_TOKEN is unset: the relay answers 200 and does nothing.
//
// Never import this file from browser code: the route files load it inside their handlers.
import { env, json, SERVICE_KEY, service, SITE_URL, SUPABASE_URL } from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import { searchFilter, splitWhy } from "@/lib/engine-leads";
import {
  channelKey,
  channelText,
  dmText,
  freshTimestamp,
  HELP_TEXT,
  leadsText,
  parseCommand,
  signatureBase,
  todayText,
  type SlackNotification,
} from "@/lib/slack";

const SLACK_API = () => (env("SLACK_API_URL") || "https://slack.com/api").replace(/\/$/, "");
type Svc = ReturnType<typeof service>;

/** One Slack Web API call. Never throws: a failure comes back as { ok: false, error }. */
async function slack(method: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`${SLACK_API()}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("SLACK_BOT_TOKEN")}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as {
      ok: boolean;
      error?: string;
      [k: string]: unknown;
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** users.lookupByEmail and users.info are GET-style methods: form-encoded. */
async function slackGet(method: string, params: Record<string, string>) {
  try {
    const res = await fetch(`${SLACK_API()}/${method}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${env("SLACK_BOT_TOKEN")}` },
    });
    return (await res.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      error?: string;
      user?: { id?: string; deleted?: boolean; profile?: { email?: string } };
    };
  } catch {
    return { ok: false as const, error: "network" };
  }
}

// ---------- the relay ----------

let relaySecret: { value: string; at: number } | null = null;

/** The relay secret, read from the database's Vault (cached for ten minutes). */
async function expectedSecret(svc: Svc): Promise<string> {
  if (relaySecret && Date.now() - relaySecret.at < 600_000) return relaySecret.value;
  const r = await svc.rpc("slack_relay_secret" as never);
  const value = typeof r.data === "string" ? r.data : "";
  if (value) relaySecret = { value, at: Date.now() };
  return value;
}

export async function slackRelay(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY()) return json(500, { error: "No database settings." });
  const svc = service();
  const expected = await expectedSecret(svc);
  if (!expected || !sameSecret(request.headers.get("x-slack-relay-secret") ?? "", expected))
    return json(401, { error: "Not the database." });
  if (!env("SLACK_BOT_TOKEN")) return json(200, { skipped: "Slack is not set up." });

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
  const n = r.data as (SlackNotification & { user_id: string }) | null;
  if (!n) return json(404, { error: "No such notification." });

  const site = SITE_URL();
  const out: Record<string, unknown> = {};

  // the person's own DM, matched on the email they sign in to Lamp with
  const p = await svc.from("profiles").select("email").eq("id", n.user_id).maybeSingle();
  const email = (p.data as { email: string | null } | null)?.email?.trim().toLowerCase() ?? "";
  if (email) {
    const who = await slackGet("users.lookupByEmail", { email });
    if (who.ok && who.user?.id && !who.user.deleted) {
      const sent = await slack("chat.postMessage", {
        channel: who.user.id,
        text: dmText(n, site),
        unfurl_links: false,
      });
      out["dm"] = sent.ok ? "sent" : sent.error;
    } else out["dm"] = "not in Slack";
  } else out["dm"] = "no email";

  // deal events to the team channel, once per event though the rep and their admin both hear it
  const key = channelKey(n);
  const channel = env("SLACK_DEALS_CHANNEL");
  if (key && channel) {
    const claim = await svc
      .from("slack_channel_posts" as never)
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
      const posted = await slack("chat.postMessage", {
        channel,
        text: channelText(n, site, repName),
        unfurl_links: false,
      });
      out["channel"] = posted.ok ? "posted" : posted.error;
    } else out["channel"] = claim.error ? "couldn't claim" : "already posted";
  }
  return json(200, out);
}

// ---------- /lamp ----------

/** Slack signed this request with the app's signing secret, within the last five minutes. */
async function signedBySlack(request: Request, raw: string): Promise<boolean> {
  const secret = env("SLACK_SIGNING_SECRET");
  const ts = request.headers.get("x-slack-request-timestamp") ?? "";
  const sig = request.headers.get("x-slack-signature") ?? "";
  if (!secret || !sig.startsWith("v0=") || !freshTimestamp(ts)) return false;
  const { createHmac } = await import("node:crypto");
  const want = "v0=" + createHmac("sha256", secret).update(signatureBase(ts, raw)).digest("hex");
  return sameSecret(sig, want);
}

const say = (text: string) =>
  new Response(JSON.stringify({ response_type: "ephemeral", text }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

export async function slackCommand(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 8192) return new Response("Too big", { status: 413 });
  if (!(await signedBySlack(request, raw))) return new Response("Not Slack", { status: 401 });
  if (!SUPABASE_URL() || !SERVICE_KEY() || !env("SLACK_BOT_TOKEN"))
    return say("Lamp isn't connected to Slack yet. Ask Asad.");

  const form = new URLSearchParams(raw);
  const command = parseCommand(form.get("text") ?? "");
  if (command.cmd === "help") return say(HELP_TEXT);

  // who's asking: their Slack email, matched to the email they sign in to Lamp with
  const info = await slackGet("users.info", { user: form.get("user_id") ?? "" });
  const email = info.user?.profile?.email?.trim().toLowerCase() ?? "";
  if (!info.ok || !email)
    return say("I couldn't read your Slack email, so I can't tell who you are in Lamp.");
  const svc = service();
  const prof = await svc.from("profiles").select("id").ilike("email", email).limit(2);
  const ids = ((prof.data ?? []) as { id: string }[]).map((x) => x.id);
  if (ids.length !== 1)
    return say(
      `No Lamp login uses ${email}. Use the same email in Slack as you sign in to Lamp with.`,
    );
  const userId = ids[0]!;
  const [rep, roles] = await Promise.all([
    svc.from("reps").select("slug,name").eq("user_id", userId).maybeSingle(),
    svc.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const me = rep.data as { slug: string; name: string } | null;
  const isAdmin = ((roles.data ?? []) as { role: string }[]).some((r) => r.role === "admin");
  if (!me && !isAdmin) return say("Your Lamp login isn't a rep, so there's nothing to show.");
  const site = SITE_URL();

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
  let q = svc
    .from("engine_leads")
    .select("name,phone,contact_phone,status,reason,contact_name,city,state")
    .order("need", { ascending: false, nullsFirst: false })
    .limit(6);
  if (!isAdmin && me) q = q.eq("rep_slug", me.slug);
  const match = searchFilter(command.query);
  if (!match) return say(HELP_TEXT);
  q = q.or(match);
  const found = await q;
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

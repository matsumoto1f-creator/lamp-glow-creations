// AI activity: GET /api/ai/activity (admins only). Never import this from browser code: the route
// file loads it inside its handler.
//
// What Claude did in Lamp and what it cost, read from the rows Lamp already keeps for every use:
// statement_reads (the statement reader), brain_briefs (the Today list) and brain_drafts (follow-up
// drafts). Staff can't read the last two from their own client, so Lamp's server reads all three
// and returns only what the page shows: when, what kind, for whom, which business, whether it
// worked, and the cost. Nothing a statement holds leaves here beyond the bank's name, the last
// four digits of the account and the month. Read only: this route changes nothing.

import { caller, env, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import { cap as brainCap, staff } from "@/lib/brain.server";
import { cap as statementCap } from "@/lib/statement-read.server";
import { keyInfo } from "@/lib/ai-key.server";
import type { KeyInfo } from "@/lib/ai-key";
import {
  type AiResult,
  type AiUse,
  type BudgetKey,
  type OffReason,
  draftLine,
  errorLine,
  latest,
  monthStart,
  offReason,
  statementLine,
  summarize,
} from "@/lib/ai-activity";

const ROWS = 500; // per log, newest first: far more than a month of use at the default budgets
const LISTED = 100;

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const short = (v: unknown, max: number) => {
  const s = str(v);
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
};

export type AiActivity = {
  /** where the Anthropic key in use comes from, and who saved it; never the key */
  key: KeyInfo;
  budgets: { key: BudgetKey; cap: number; spent: number; off: OffReason | null }[];
  month: ReturnType<typeof summarize>;
  uses: AiUse[];
  /** how far back the list goes when a log held more rows than the server reads */
  truncated: boolean;
};

export async function aiActivity(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const me = await staff(who.userId);
  if (!me?.isAdmin) return json(403, { error: "AI activity is for Lamp's admins." });

  const svc = service();
  const now = new Date();
  // the month so far for the totals, and the month before so the list isn't empty on the 1st
  const since = new Date(monthStart(now));
  since.setUTCMonth(since.getUTCMonth() - 1);
  const from = since.toISOString();

  const [reads, briefs, drafts] = await Promise.all([
    svc
      .from("statement_reads" as never)
      .select("id,application_id,state,read,cost_usd,error,read_by,created_at")
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(ROWS),
    svc
      .from("brain_briefs" as never)
      .select("id,user_id,state,brief,cost_usd,error,created_at")
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(ROWS),
    svc
      .from("brain_drafts" as never)
      .select("id,user_id,kind,item_id,written,cost_usd,error,created_at")
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(ROWS),
  ]);
  if (reads.error || briefs.error || drafts.error)
    return json(503, { error: "Couldn't read the AI logs. Try again in a minute." });
  const R = (reads.data ?? []) as Raw[];
  const B = (briefs.data ?? []) as Raw[];
  const D = (drafts.data ?? []) as Raw[];

  // names for the people and businesses those rows point at
  const ids = (xs: unknown[]) => [...new Set(xs.filter((x): x is string => typeof x === "string"))];
  const people = ids([...R.map((r) => r["read_by"]), ...[...B, ...D].map((r) => r["user_id"])]);
  const fileDrafts = D.filter((d) => d["kind"] === "file");
  const linkDrafts = D.filter((d) => d["kind"] === "link");
  const files = ids([...R.map((r) => r["application_id"]), ...fileDrafts.map((d) => d["item_id"])]);
  const links = ids(linkDrafts.map((d) => d["item_id"]));
  const [profiles, seats, apps, invites] = await Promise.all([
    people.length
      ? svc.from("profiles").select("id,full_name").in("id", people)
      : { data: [] as Raw[] },
    people.length
      ? svc.from("reps").select("user_id,name").in("user_id", people)
      : { data: [] as Raw[] },
    files.length
      ? svc.from("applications").select("id,business_name").in("id", files)
      : { data: [] as Raw[] },
    links.length
      ? svc
          .from("application_invites" as never)
          .select("id,business_name,application_id")
          .in("id", links)
      : { data: [] as Raw[] },
  ]);
  const name = new Map<string, string>();
  for (const p of (profiles.data ?? []) as Raw[]) {
    const n = str(p["full_name"]);
    if (n) name.set(String(p["id"]), n);
  }
  // a rep seat's name is the one staff know them by
  for (const s of (seats.data ?? []) as Raw[]) {
    const n = str(s["name"]);
    if (n) name.set(String(s["user_id"]), n);
  }
  const business = new Map<string, string>();
  for (const a of (apps.data ?? []) as Raw[]) {
    const n = str(a["business_name"]);
    if (n) business.set(String(a["id"]), n);
  }
  const invite = new Map<string, { business: string | null; file: string | null }>();
  for (const i of (invites.data ?? []) as Raw[])
    invite.set(String(i["id"]), {
      business: str(i["business_name"]),
      file: str(i["application_id"]),
    });
  const whoOf = (id: unknown) => (typeof id === "string" ? (name.get(id) ?? null) : null);

  const uses: AiUse[] = [
    ...R.map((r): AiUse => {
      const file = str(r["application_id"]);
      const ok = r["state"] === "read";
      return {
        id: `statement:${String(r["id"])}`,
        kind: "statement",
        at: String(r["created_at"]),
        result: ok ? "worked" : "failed",
        error: ok ? null : errorLine(r["error"], "The statement couldn't be read."),
        cost: num(r["cost_usd"]),
        who: whoOf(r["read_by"]),
        business: file ? (business.get(file) ?? null) : null,
        file_id: file,
        detail: ok ? statementLine(r["read"]) : null,
      };
    }),
    ...B.map((b): AiUse => {
      const state = b["state"];
      const result: AiResult =
        state === "ai" ? "worked" : state === "failed" ? "failed" : "working";
      const brief = b["brief"] as { headline?: unknown; items?: unknown } | null;
      return {
        id: `today:${String(b["id"])}`,
        kind: "today",
        at: String(b["created_at"]),
        result,
        error:
          result === "failed" ? errorLine(b["error"], "Claude couldn't write the list.") : null,
        cost: num(b["cost_usd"]),
        who: whoOf(b["user_id"]),
        business: null,
        file_id: null,
        detail: result === "worked" ? short(brief?.headline, 160) : null,
      };
    }),
    ...D.map((d): AiUse => {
      const isFile = d["kind"] === "file";
      const item = str(d["item_id"]);
      const inv = !isFile && item ? invite.get(item) : undefined;
      const file = isFile ? item : (inv?.file ?? null);
      const failed = !!str(d["error"]);
      return {
        id: `draft:${String(d["id"])}`,
        kind: "draft",
        at: String(d["created_at"]),
        result: failed ? "failed" : "worked",
        error: failed ? errorLine(d["error"], "Claude couldn't write the draft.") : null,
        cost: num(d["cost_usd"]),
        who: whoOf(d["user_id"]),
        business: isFile ? (item ? (business.get(item) ?? null) : null) : (inv?.business ?? null),
        file_id: file,
        detail: failed ? null : draftLine(d["written"]),
      };
    }),
  ];

  const month = summarize(uses, now);
  const key = await keyInfo();
  const hasKey = key.source !== null;
  const body: AiActivity = {
    key,
    budgets: [
      {
        key: "statements",
        cap: statementCap(),
        spent: month.spent.statements,
        off: offReason(hasKey, env("LAMP_STATEMENTS")),
      },
      {
        key: "brain",
        cap: brainCap(),
        spent: month.spent.brain,
        off: offReason(hasKey, env("LAMP_BRAIN")),
      },
    ],
    month,
    uses: latest(uses, LISTED),
    truncated: R.length === ROWS || B.length === ROWS || D.length === ROWS,
  };
  return json(200, body);
}

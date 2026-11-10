// Server side of the statement reader (POST /api/statements; migration 20261102180000_statement_reader.sql).
// Never import this from browser code: the route file loads it inside its handler.
//
//   { action: "get", application_id }                  the file's statements, reads and report
//   { action: "read", application_id, document_id }    read one statement with Claude, then redo the report
//   { action: "confirm", application_id, numbers }     a person confirms the report, fixing any number
//
// Staff only, and only on files their own rules already show them: the file and its documents are
// looked up as the caller, and opening a statement is logged like any other document open
// (open_document). One statement per request, so a slow read never holds the page past a
// gateway's timeout; the browser asks for the next one. The model only reads: every number a
// funder decides on is worked out in statement-read.ts, and a statement that doesn't add up gives
// no verified numbers. Runs only when Lamp has an Anthropic key (and LAMP_STATEMENTS not "off"), and
// stops for the month at STATEMENT_MONTHLY_CAP_USD (50 by default).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { caller, env, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import { anthropicKey } from "@/lib/ai-key.server";
import { readJson } from "@/lib/application-links.server";
import { staff, why } from "@/lib/brain.server";
import { figures, type Figures, type StatementRead } from "@/lib/statement-read";

export const MODEL = "claude-opus-5-5";
// $ per million tokens on claude-opus-5-5 (same figures as brain.server.ts)
const PRICE = { input: 4, output: 20 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// the API takes a 32 MB request; base64 grows a file by a third
const MAX_BYTES = 22 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export const on = async () =>
  env("LAMP_STATEMENTS").toLowerCase() !== "off" && !!(await anthropicKey()).key;
export const cap = () => {
  const v = Number(env("STATEMENT_MONTHLY_CAP_USD"));
  return Number.isFinite(v) && v >= 0 && env("STATEMENT_MONTHLY_CAP_USD") !== "" ? v : 50;
};

// Stable on purpose: nothing per-file in here.
const SYSTEM = `You read US business bank statements for Lamp, a business-funding brokerage. You only read and copy what the statement shows; you never judge the business or whether it qualifies.

Return, for the one statement you're given:
- bank: the bank's name. account_last4: the last four digits of the account number, or null.
- period_start, period_end: the statement period, YYYY-MM-DD.
- opening_balance, closing_balance, total_deposits, total_withdrawals: the statement's own summary figures in dollars. If there is no summary, add up the transaction lines. deposit_count: how many deposits and credits there were.
- non_revenue_deposits: deposits that are not sales: transfers in from the owner's other accounts, proceeds from a funder, lender or advance, refunds or reversals of the business's own payments, owner contributions. Leave out card settlements, customer payments and cash deposits.
- nsf_events: every NSF fee, returned-item fee, overdraft fee or returned/insufficient-funds item, one entry per line.
- daily_balances: the end-of-day balance for each day the statement shows one: the daily balance table if there is one, otherwise the running balance after the last transaction of each day. Leave the list empty if the statement shows no balances by day.
- funder_debits: debits that repeat and look like payments to a merchant cash advance company, funder or lender (often daily or weekly ACH debits of the same amount). Group the same payee at the same amount into one entry with every date it was taken. Copy the description as printed. Leave out rent, payroll, card fees, taxes, insurance and utilities.
- incomplete: true when pages are missing, cut off or unreadable, or the figures can't be read with confidence.

Money is a plain number in dollars: 1234.56, never a string, never negative except balances below zero. Dates are YYYY-MM-DD. Copy, don't estimate: if a figure isn't on the statement, use 0 for money and an empty list for lists, and set incomplete to true.`;

const Line = z.object({ date: z.string(), amount: z.number(), description: z.string() });
const ReadSchema = z.object({
  bank: z.string(),
  account_last4: z.string().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  opening_balance: z.number(),
  closing_balance: z.number(),
  total_deposits: z.number(),
  deposit_count: z.number(),
  total_withdrawals: z.number(),
  non_revenue_deposits: z.array(Line),
  nsf_events: z.array(Line),
  daily_balances: z.array(z.object({ date: z.string(), balance: z.number() })),
  funder_debits: z.array(
    z.object({ description: z.string(), amount: z.number(), dates: z.array(z.string()) }),
  ),
  incomplete: z.boolean(),
});

type Who = NonNullable<Awaited<ReturnType<typeof caller>>>;
type Svc = ReturnType<typeof service>;

type Body = {
  action?: unknown;
  application_id?: unknown;
  document_id?: unknown;
  numbers?: unknown;
};

/** The numbers a person may fix on the report before confirming. */
export const EDITABLE = [
  "avg_monthly_revenue",
  "avg_daily_balance",
  "nsf_max_month",
  "negative_days",
  "position_fit",
] as const;
type Editable = (typeof EDITABLE)[number];

export async function statementsAction(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const me = await staff(who.userId);
  if (!me) return json(403, { error: "The statement report is for Lamp staff." });
  const body = await readJson<Body>(request, 4096);
  if (body instanceof Response) return body;
  const id =
    typeof body.application_id === "string" && UUID.test(body.application_id)
      ? body.application_id
      : "";
  if (!id) return json(400, { error: "application_id is required." });
  // the caller's own rules decide whether this file is theirs to see
  const file = await who.client.from("applications").select("id").eq("id", id).maybeSingle();
  if (file.error) return json(500, { error: "Couldn't open that file." });
  if (!file.data) return json(404, { error: "That file isn't one you can see." });
  const svc = service();

  if (body.action === "get") return json(200, await state(who, svc, id));
  if (body.action === "read") {
    const doc =
      typeof body.document_id === "string" && UUID.test(body.document_id) ? body.document_id : "";
    if (!doc) return json(400, { error: "document_id is required." });
    return readOne(who, svc, id, doc);
  }
  if (body.action === "confirm") return confirm(who, svc, id, body.numbers, me.name);
  return json(400, { error: "Unknown action." });
}

/** This month's spend on the reader, in dollars. */
async function spent(svc: Svc): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = await svc
    .from("statement_reads")
    .select("cost_usd")
    .gte("created_at", start.toISOString());
  return ((r.data ?? []) as { cost_usd: number | string }[]).reduce(
    (s, x) => s + Number(x.cost_usd || 0),
    0,
  );
}

/** The file's bank statements (as the caller sees them), their reads, and the report. */
async function state(who: Who, svc: Svc, id: string) {
  const [docs, reads, report, used] = await Promise.all([
    who.client
      .from("documents")
      .select("id,original_name,storage_path,mime_type,created_at")
      .eq("application_id", id)
      .eq("kind", "bank_statement")
      .order("created_at"),
    svc
      .from("statement_reads")
      .select("document_id,state,error,created_at")
      .eq("application_id", id),
    svc.from("statement_reports").select("*").eq("application_id", id).maybeSingle(),
    spent(svc),
  ]);
  const byDoc = new Map(
    (
      (reads.data ?? []) as {
        document_id: string;
        state: string;
        error: string | null;
        created_at: string;
      }[]
    ).map((r) => [r.document_id, r]),
  );
  const statements = (
    (docs.data ?? []) as {
      id: string;
      original_name: string | null;
      storage_path: string;
      mime_type: string | null;
    }[]
  ).map((d) => {
    const r = byDoc.get(d.id);
    return {
      document_id: d.id,
      name:
        d.original_name ||
        d.storage_path.slice(d.storage_path.lastIndexOf("/") + 1).replace(/^\d+-/, ""),
      state: r ? (r.state as "read" | "failed") : ("unread" as const),
      error: r?.error ?? null,
      readable: readableType(d.mime_type, d.original_name ?? d.storage_path) !== null,
    };
  });
  const isOn = await on();
  return {
    on: isOn,
    paused: isOn && used >= cap(),
    statements,
    report: (report.data as Record<string, unknown> | null) ?? null,
  };
}

/** What the API is told the file is, or null for a type it can't read (HEIC, Word, ...). */
function readableType(
  mime: string | null,
  name: string,
): "application/pdf" | (typeof IMAGE_TYPES)[number] | null {
  const m = (mime ?? "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (m === "application/pdf" || ext === "pdf") return "application/pdf";
  const img = IMAGE_TYPES.find((t) => t === m);
  if (img) return img;
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return null;
}

async function readOne(who: Who, svc: Svc, id: string, docId: string): Promise<Response> {
  if (!(await on()))
    return json(503, { error: "The statement reader is off: Lamp's Anthropic key isn't set." });
  if ((await spent(svc)) >= cap())
    return json(503, { error: "The statement reader has reached this month's spending cap." });
  const row = await who.client
    .from("documents")
    .select("id,application_id,bucket,storage_path,mime_type,original_name,kind")
    .eq("id", docId)
    .maybeSingle();
  const d = row.data as {
    id: string;
    application_id: string;
    bucket: string | null;
    storage_path: string;
    mime_type: string | null;
    original_name: string | null;
    kind: string;
  } | null;
  if (!d || d.application_id !== id || d.kind !== "bank_statement")
    return json(404, { error: "That statement isn't on this file." });
  const type = readableType(d.mime_type, d.original_name ?? d.storage_path);
  if (!type)
    return json(415, {
      error: "Lamp reads PDFs and photos (JPG, PNG). Ask for this statement as a PDF.",
    });

  // opening a statement is logged like any other document open, and its own rules decide
  const logged = await who.client.rpc("open_document" as never, { _document_id: docId } as never);
  if (logged.error) return json(403, { error: "That statement isn't yours to open." });
  const file = await who.client.storage.from(d.bucket || "documents").download(d.storage_path);
  if (file.error || !file.data) return json(500, { error: "Couldn't open that statement." });
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES)
    return json(413, { error: "That statement is too large to read (over 22 MB)." });

  let saved: {
    read: StatementRead | null;
    error: string | null;
    model: string | null;
    usage: { input: number; output: number };
    cost: number;
  };
  try {
    saved = await ask(bytes, type);
  } catch (e) {
    saved = { read: null, error: why(e), model: null, usage: { input: 0, output: 0 }, cost: 0 };
  }
  const up = await svc.from("statement_reads").upsert(
    {
      application_id: id,
      document_id: docId,
      state: saved.read ? "read" : "failed",
      read: saved.read,
      model: saved.model,
      input_tokens: saved.usage.input,
      output_tokens: saved.usage.output,
      cost_usd: Math.round(saved.cost * 10_000) / 10_000,
      error: saved.error?.slice(0, 300) ?? null,
      read_by: who.userId,
      created_at: new Date().toISOString(),
    } as never,
    { onConflict: "document_id" },
  );
  if (up.error) return json(500, { error: "Couldn't save the read." });
  await rebuild(svc, id);
  return json(saved.read ? 200 : 502, {
    ...(await state(who, svc, id)),
    ...(saved.error ? { error: saved.error } : {}),
  });
}

/** One statement to Claude; the parsed read and what it cost. */
async function ask(bytes: Uint8Array, type: ReturnType<typeof readableType> & string) {
  const client = new Anthropic({
    apiKey: (await anthropicKey()).key,
    timeout: 240_000,
    maxRetries: 1,
  });
  const data = Buffer.from(bytes).toString("base64");
  const source =
    type === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: type, data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: type, data } } as const);
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ReadSchema) },
    system: SYSTEM,
    messages: [
      { role: "user", content: [source, { type: "text", text: "Read this bank statement." }] },
    ],
  });
  const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
  const cost = (usage.input * PRICE.input + usage.output * PRICE.output) / 1_000_000;
  const out = { usage, cost, model: res.model };
  if (res.stop_reason === "refusal")
    return { ...out, read: null, error: "The model declined to read it." };
  if (res.stop_reason === "max_tokens")
    return { ...out, read: null, error: "The statement was too long to read in one go." };
  const parsed = res.parsed_output;
  if (!parsed)
    return { ...out, read: null, error: "The read didn't come back in the expected shape." };
  return { ...out, read: parsed as StatementRead, error: null };
}

/**
 * The file's report from every good read. New numbers clear an earlier confirmation: the person
 * confirms what's there now.
 */
async function rebuild(svc: Svc, id: string): Promise<Figures> {
  const [reads, details] = await Promise.all([
    svc.from("statement_reads").select("read").eq("application_id", id).eq("state", "read"),
    svc.from("application_details").select("business").eq("application_id", id).maybeSingle(),
  ]);
  const good = ((reads.data ?? []) as { read: StatementRead | null }[])
    .map((r) => r.read)
    .filter((r): r is StatementRead => !!r);
  const biz = (details.data as { business?: { monthly_revenue?: string } } | null)?.business;
  const stated = Number(String(biz?.monthly_revenue ?? "").replace(/[$,\s]/g, ""));
  const f = figures(
    good,
    Number.isFinite(stated) && stated > 0 ? stated : null,
    new Date().toISOString().slice(0, 10),
  );
  await svc.from("statement_reports").upsert(
    {
      application_id: id,
      figures: f,
      confirmed: null,
      edits: {},
      confirmed_by: null,
      confirmed_by_name: null,
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "application_id" },
  );
  return f;
}

async function confirm(
  who: Who,
  svc: Svc,
  id: string,
  numbers: unknown,
  name: string | null,
): Promise<Response> {
  const got = await svc
    .from("statement_reports")
    .select("figures")
    .eq("application_id", id)
    .maybeSingle();
  const f = (got.data as { figures: Figures } | null)?.figures;
  if (!f) return json(409, { error: "Read the statements first." });
  const given =
    numbers && typeof numbers === "object" && !Array.isArray(numbers)
      ? (numbers as Record<string, unknown>)
      : {};
  const edits: Partial<Record<Editable, [number | null, number]>> = {};
  const confirmed: Figures = { ...f };
  for (const k of EDITABLE) {
    if (!(k in given)) continue;
    const v = given[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9)
      return json(400, { error: `Check the number for ${k.replace(/_/g, " ")}.` });
    const n =
      k === "avg_monthly_revenue" || k === "avg_daily_balance"
        ? Math.round(v * 100) / 100
        : Math.round(v);
    if (k === "position_fit" && n < 1)
      return json(400, { error: "Position fit starts at 1 (first position)." });
    if (n !== f[k]) {
      edits[k] = [f[k], n];
      (confirmed as Record<Editable, number | null>)[k] = n;
    }
  }
  const up = await svc
    .from("statement_reports")
    .update({
      confirmed,
      edits,
      confirmed_by: who.userId,
      confirmed_by_name: name,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("application_id", id);
  if (up.error) return json(500, { error: "Couldn't save that. Try again." });
  return json(200, await state(who, svc, id));
}

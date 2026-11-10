// AI activity (admins): what Claude did in Lamp, when, for whom, whether it worked and what it
// cost. Lamp already keeps a row for each use (statement_reads, brain_briefs, brain_drafts); this
// turns those rows into the page's lines and totals. Claude does three jobs in Lamp, on two
// budgets: the Today list and follow-up drafts share one (BRAIN_MONTHLY_CAP_USD), the statement
// reader has its own (STATEMENT_MONTHLY_CAP_USD). No imports, so the Deno tests load it as is.

export type AiKind = "statement" | "today" | "draft";
export const AI_KINDS: readonly AiKind[] = ["statement", "today", "draft"];
export const AI_KIND_LABEL: Record<AiKind, string> = {
  statement: "Bank statement read",
  today: "Today list",
  draft: "Follow-up draft",
};
/** The month's count tiles. */
export const AI_KIND_COUNT_LABEL: Record<AiKind, string> = {
  statement: "Bank statements read",
  today: "Today lists written",
  draft: "Follow-up drafts written",
};

export type AiResult = "worked" | "failed" | "working";

/** One time Claude was used. */
export type AiUse = {
  id: string;
  kind: AiKind;
  at: string;
  result: AiResult;
  /** why it failed, in Lamp's own words (never the model's raw output) */
  error: string | null;
  cost: number;
  /** the staff member it was for */
  who: string | null;
  business: string | null;
  /** the file to open, when there is one */
  file_id: string | null;
  /** a short line on what it was: the statement's bank and month, or the list's headline */
  detail: string | null;
};

export type BudgetKey = "brain" | "statements";
export const BUDGET_KEYS: readonly BudgetKey[] = ["statements", "brain"];
export const BUDGET_OF: Record<AiKind, BudgetKey> = {
  statement: "statements",
  today: "brain",
  draft: "brain",
};
export const BUDGET_LABEL: Record<BudgetKey, string> = {
  brain: "Today list and follow-up drafts",
  statements: "Statement reader",
};

/** Why a job isn't running, or null when it is. */
export type OffReason = "no_key" | "switched_off";
export const OFF_LINE: Record<OffReason, string> = {
  no_key: "Off: Lamp's Anthropic key isn't set in the server's secrets.",
  switched_off: "Off: switched off in the server's settings.",
};
export const offReason = (hasKey: boolean, switchValue: string): OffReason | null =>
  !hasKey ? "no_key" : switchValue.trim().toLowerCase() === "off" ? "switched_off" : null;

/** The first moment of the month, UTC: the same line the server's budget checks use. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
const inMonth = (u: AiUse, now: Date) => Date.parse(u.at) >= monthStart(now).getTime();

export type KindCount = { uses: number; failed: number; cost: number };
export type MonthSummary = {
  uses: number;
  failed: number;
  cost: number;
  byKind: Record<AiKind, KindCount>;
  spent: Record<BudgetKey, number>;
};

/** This month's totals. Uses still in progress count as a use, not as a failure. */
export function summarize(uses: readonly AiUse[], now: Date): MonthSummary {
  const byKind: Record<AiKind, KindCount> = {
    statement: { uses: 0, failed: 0, cost: 0 },
    today: { uses: 0, failed: 0, cost: 0 },
    draft: { uses: 0, failed: 0, cost: 0 },
  };
  const spent: Record<BudgetKey, number> = { brain: 0, statements: 0 };
  let total = 0;
  let failed = 0;
  let cost = 0;
  for (const u of uses) {
    if (!inMonth(u, now)) continue;
    const c = Number.isFinite(u.cost) && u.cost > 0 ? u.cost : 0;
    const k = byKind[u.kind];
    k.uses++;
    k.cost += c;
    spent[BUDGET_OF[u.kind]] += c;
    total++;
    cost += c;
    if (u.result === "failed") {
      k.failed++;
      failed++;
    }
  }
  return { uses: total, failed, cost, byKind, spent };
}

export type BudgetState = "ok" | "near" | "used";
export type BudgetView = { fill: number; left: number; state: BudgetState };

/** How much of a monthly budget is gone. "near" from 80%; "used" means Claude has stopped for the month. */
export function budgetView(spent: number, cap: number): BudgetView {
  const s = Number.isFinite(spent) && spent > 0 ? spent : 0;
  if (!(cap > 0)) return { fill: 1, left: 0, state: "used" };
  const fill = Math.min(1, s / cap);
  return {
    fill,
    left: Math.max(0, cap - s),
    state: s >= cap ? "used" : fill >= 0.8 ? "near" : "ok",
  };
}

/** Dollars for the page: cents normally, a fraction of a cent shown as "under $0.01". */
export function usd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return "under $0.01";
  return `$${n.toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Chase ••1234, Oct 2026" from a statement read's own fields; null when it holds nothing usable. */
export function statementLine(read: unknown): string | null {
  if (!read || typeof read !== "object") return null;
  const r = read as Record<string, unknown>;
  const bank = typeof r["bank"] === "string" ? r["bank"].trim().slice(0, 40) : "";
  const last4 =
    typeof r["account_last4"] === "string" && /^\d{4}$/.test(r["account_last4"])
      ? ` ••${r["account_last4"]}`
      : "";
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(
    typeof r["period_end"] === "string" ? r["period_end"] : "",
  );
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  const when = m && month ? `${month} ${m[1]}` : "";
  const line = [bank ? `${bank}${last4}` : "", when].filter(Boolean).join(", ");
  return line || null;
}

/**
 * Why a use failed, for the page. Lamp's own sentences pass through; the two short codes the logs
 * keep when Claude stops early are spelled out. Never longer than 200 characters.
 */
export function errorLine(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return fallback;
  if (s === "stop: refusal") return "Claude declined to write this one.";
  if (s === "stop: max_tokens") return "Claude's answer ran too long.";
  if (s.startsWith("stop:")) return fallback;
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

const DRAFT_PART: Record<string, string> = {
  text: "the text",
  email_subject: "the email",
  email_body: "the email",
  call: "the call notes",
};

/**
 * Which parts of a follow-up draft are Claude's words. Lamp checks each part before a rep sees it
 * and keeps its own wording for any part that fails, so a draft can be partly or wholly Lamp's.
 */
export function draftLine(written: unknown): string {
  const parts = Array.isArray(written)
    ? [...new Set(written.map((w) => DRAFT_PART[String(w)]).filter((p): p is string => !!p))]
    : [];
  if (!parts.length) return "Claude's wording didn't pass Lamp's check, so Lamp's own was used.";
  return `Claude wrote ${parts.join(", ")}.`;
}

/** Newest first, capped: the page lists the latest uses, the totals count the whole month. */
export function latest(uses: readonly AiUse[], limit = 100): AiUse[] {
  return [...uses].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

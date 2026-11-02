// The statement reader's math (scope: claude.ai/artifact/9LmyqMvwAJPD4HgAon7n96, phase 1).
//
// Claude reads each bank statement into a StatementRead (statement-read.server.ts); everything a
// funder decides on is worked out here, in plain code: monthly deposits, average daily balance,
// NSFs, negative days, open positions and what they take out, position fit, and flags. The model
// never decides anything. A statement whose totals don't reconcile (opening + deposits -
// withdrawals = closing, to the dollar) gives no verified numbers: the report says to check it by
// hand. Pure and import-free, so it's unit-tested in tests/statement-read.test.ts.

/** One statement, as the model read it. Money in dollars, dates YYYY-MM-DD. */
export type StatementRead = {
  bank: string;
  account_last4: string | null;
  period_start: string;
  period_end: string;
  opening_balance: number;
  closing_balance: number;
  total_deposits: number;
  deposit_count: number;
  total_withdrawals: number;
  /** Deposits that aren't sales: transfers from the owner's other accounts, funding proceeds, reversals. */
  non_revenue_deposits: { date: string; amount: number; description: string }[];
  /** Every NSF, returned-item or overdraft fee line. */
  nsf_events: { date: string; amount: number; description: string }[];
  /** End-of-day balances: the statement's daily balance table, else the last running balance each day. */
  daily_balances: { date: string; balance: number }[];
  /** Repeating debits that look like payments to a funder or lender, descriptor as printed. */
  funder_debits: { description: string; amount: number; dates: string[] }[];
  /** True when pages were missing or unreadable. */
  incomplete: boolean;
};

export type Position = {
  /** The descriptor as printed on the latest statement. */
  description: string;
  cadence: "daily" | "weekly" | "other";
  payment: number;
  /** Rough monthly total: daily x 21, weekly x 4.33. */
  monthly: number;
  last_date: string;
};

export type StatementCheck = {
  period_start: string;
  period_end: string;
  bank: string;
  reconciles: boolean;
  /** opening + deposits - withdrawals - closing, in dollars (0 when it reconciles). */
  off_by: number;
  incomplete: boolean;
};

export type Figures = {
  /** Every statement reconciled and none was incomplete. Only then do the numbers count. */
  verified: boolean;
  months: number;
  period_start: string | null;
  period_end: string | null;
  /** Average monthly deposits less non-revenue deposits. */
  avg_monthly_revenue: number;
  avg_monthly_deposits: number;
  avg_deposit_count: number;
  avg_daily_balance: number | null;
  nsf_total: number;
  nsf_max_month: number;
  negative_days: number | null;
  positions: Position[];
  /** Monthly payments to open positions as a share of monthly revenue, 0 to 1. */
  holdback: number;
  /** 1 = first position (nothing open), 2 = second, ... */
  position_fit: number;
  statements: StatementCheck[];
  flags: string[];
};

const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100) / 100;
const time = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const isDate = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(time(d));

/** opening + deposits - withdrawals = closing, within a dollar (banks round per line). */
export function reconcile(r: StatementRead): StatementCheck {
  const off = cents(r.opening_balance + r.total_deposits - r.total_withdrawals - r.closing_balance);
  return {
    period_start: r.period_start,
    period_end: r.period_end,
    bank: r.bank,
    reconciles: Math.abs(off) <= 1 && !r.incomplete,
    off_by: Math.abs(off) <= 1 ? 0 : off,
    incomplete: r.incomplete,
  };
}

/**
 * Every calendar day of the statement with its closing balance: the opening balance until the
 * first listed day, then each listed balance carried forward. Null when no daily balances were read.
 */
export function dailySeries(r: StatementRead): number[] | null {
  if (!isDate(r.period_start) || !isDate(r.period_end) || r.daily_balances.length === 0)
    return null;
  const listed = new Map<string, number>();
  for (const b of r.daily_balances) if (isDate(b.date)) listed.set(b.date, b.balance);
  if (listed.size === 0) return null;
  const out: number[] = [];
  let bal = r.opening_balance;
  for (let t = time(r.period_start); t <= time(r.period_end); t += DAY) {
    const v = listed.get(iso(t));
    if (v !== undefined) bal = v;
    out.push(bal);
  }
  return out;
}

const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Median gap in days between consecutive dates. */
function medianGap(dates: string[]): number | null {
  const ts = [...new Set(dates.filter(isDate))].map(time).sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const gaps = ts
    .slice(1)
    .map((t, i) => (t - ts[i]!) / DAY)
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/**
 * Open positions: funder debits still being paid in the latest statement. The same descriptor is
 * one position; a daily debit (median gap up to 3 days, which covers weekends) or a weekly one
 * (5 to 9 days) needs at least 3 payments to count; anything else is listed as "other".
 */
export function positions(reads: StatementRead[]): Position[] {
  const latest = [...reads].sort((a, b) => time(b.period_end) - time(a.period_end))[0];
  if (!latest) return [];
  const groups = new Map<string, { description: string; amount: number; dates: string[] }>();
  for (const d of latest.funder_debits) {
    if (!(d.amount > 0) || d.dates.length === 0) continue;
    const key = norm(d.description);
    const g = groups.get(key);
    if (g) g.dates.push(...d.dates);
    else groups.set(key, { description: d.description, amount: d.amount, dates: [...d.dates] });
  }
  const out: Position[] = [];
  for (const g of groups.values()) {
    const dates = [...new Set(g.dates.filter(isDate))].sort();
    if (dates.length === 0) continue;
    const gap = medianGap(dates);
    const cadence: Position["cadence"] =
      dates.length >= 3 && gap !== null && gap <= 3
        ? "daily"
        : dates.length >= 3 && gap !== null && gap >= 5 && gap <= 9
          ? "weekly"
          : "other";
    const monthly =
      cadence === "daily"
        ? g.amount * 21
        : cadence === "weekly"
          ? g.amount * 4.33
          : g.amount * dates.length;
    out.push({
      description: g.description,
      cadence,
      payment: cents(g.amount),
      monthly: cents(monthly),
      last_date: dates[dates.length - 1]!,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/**
 * The file's figures from all its statements. `stated` is the monthly revenue the merchant typed
 * (null when they didn't), `today` is YYYY-MM-DD.
 */
export function figures(reads: StatementRead[], stated: number | null, today: string): Figures {
  const sorted = [...reads]
    .filter((r) => isDate(r.period_start) && isDate(r.period_end))
    .sort((a, b) => time(a.period_start) - time(b.period_start));
  const checks = sorted.map(reconcile);
  const flags: string[] = [];
  const n = sorted.length;
  const sum = (f: (r: StatementRead) => number) => sorted.reduce((s, r) => s + f(r), 0);

  const deposits = n ? sum((r) => r.total_deposits) / n : 0;
  const nonRevenue = n
    ? sum((r) => r.non_revenue_deposits.reduce((s, d) => s + (d.amount > 0 ? d.amount : 0), 0)) / n
    : 0;
  const revenue = Math.max(0, deposits - nonRevenue);
  const count = n ? sum((r) => r.deposit_count) / n : 0;

  const series = sorted.map(dailySeries);
  const days = series.flatMap((s) => s ?? []);
  const allDaily = series.length > 0 && series.every((s) => s !== null);
  const adb = allDaily && days.length ? cents(days.reduce((s, v) => s + v, 0) / days.length) : null;
  const negative = allDaily ? days.filter((v) => v < 0).length : null;

  const nsfPer = sorted.map((r) => r.nsf_events.length);
  const open = positions(sorted);
  const owed = open.filter((p) => p.cadence !== "other").reduce((s, p) => s + p.monthly, 0);

  for (const c of checks) {
    if (c.incomplete)
      flags.push(
        `The ${c.bank} statement ending ${c.period_end} has missing or unreadable pages: check it by hand.`,
      );
    else if (!c.reconciles)
      flags.push(
        `The ${c.bank} statement ending ${c.period_end} doesn't add up (off by $${Math.abs(c.off_by).toLocaleString("en-US")}): check it by hand.`,
      );
  }
  if (n === 0) flags.push("No statements could be read.");
  else if (n < 3)
    flags.push(`Only ${n} month${n === 1 ? "" : "s"} of statements; most funders want 3.`);
  for (let i = 1; i < n; i++) {
    const gap = (time(sorted[i]!.period_start) - time(sorted[i - 1]!.period_end)) / DAY;
    if (gap > 5)
      flags.push(
        `A gap between ${sorted[i - 1]!.period_end} and ${sorted[i]!.period_start}: a month may be missing.`,
      );
  }
  const last = n ? sorted[n - 1]!.period_end : null;
  if (last && (time(today) - time(last)) / DAY > 45)
    flags.push(`The latest statement ended ${last}; funders want one from the last 30 to 45 days.`);
  if (stated && stated > 0 && revenue > 0 && Math.abs(revenue - stated) / stated > 0.25)
    flags.push(
      `The statements show about $${Math.round(revenue).toLocaleString("en-US")} a month; the application says $${Math.round(stated).toLocaleString("en-US")}.`,
    );
  if (!allDaily && n > 0)
    flags.push(
      "Daily balances weren't on every statement, so average daily balance and negative days are unknown.",
    );

  return {
    verified: n > 0 && checks.every((c) => c.reconciles),
    months: n,
    period_start: n ? sorted[0]!.period_start : null,
    period_end: last,
    avg_monthly_revenue: cents(revenue),
    avg_monthly_deposits: cents(deposits),
    avg_deposit_count: Math.round(count * 10) / 10,
    avg_daily_balance: adb,
    nsf_total: nsfPer.reduce((s, v) => s + v, 0),
    nsf_max_month: nsfPer.length ? Math.max(...nsfPer) : 0,
    negative_days: negative,
    positions: open,
    holdback: revenue > 0 ? Math.round((owed / revenue) * 1000) / 1000 : 0,
    position_fit: open.filter((p) => p.cadence !== "other").length + 1,
    statements: checks,
    flags,
  };
}

/** "1st", "2nd", "3rd", "4th" ... for position fit. */
export const ordinal = (n: number) => {
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${s}`;
};

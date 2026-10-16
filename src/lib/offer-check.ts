// Offer Check: turns an offer a merchant already has into plain dollars and an estimated
// yearly rate. Pure functions only, so the math can be checked without the page.
//
// The numbers follow how funders actually write offers: a payment frequency (daily, weekly,
// every two weeks, monthly), a term in days, weeks or months, or a stated payment amount.

/** About 21 business days and 52/12 weeks in a month (same convention as the home page). */
export const BUSINESS_DAYS_PER_MONTH = 21;
export const WEEKS_PER_MONTH = 52 / 12;

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly";
export type TermUnit = "days" | "weeks" | "months";

export const FREQUENCIES: { value: Frequency; label: string; short: string; per: string }[] = [
  { value: "daily", label: "Every business day", short: "Daily", per: "Each business day" },
  { value: "weekly", label: "Every week", short: "Weekly", per: "Each week" },
  { value: "biweekly", label: "Every two weeks", short: "Bi-weekly", per: "Every two weeks" },
  { value: "monthly", label: "Every month", short: "Monthly", per: "Each month" },
];

const PERIODS_PER_MONTH: Record<Frequency, number> = {
  daily: BUSINESS_DAYS_PER_MONTH,
  weekly: WEEKS_PER_MONTH,
  biweekly: WEEKS_PER_MONTH / 2,
  monthly: 1,
};
const PERIODS_PER_YEAR: Record<Frequency, number> = {
  daily: BUSINESS_DAYS_PER_MONTH * 12,
  weekly: 52,
  biweekly: 26,
  monthly: 12,
};
/** How many of these payments land in one week. */
const PER_WEEK: Record<Frequency, number> = {
  daily: 5,
  weekly: 1,
  biweekly: 0.5,
  monthly: 12 / 52,
};

/** Where we start telling owners to be careful. Adjust here; the page reads these. */
export const DEPOSIT_SHARE_CAUTION = 0.15;
export const DEPOSIT_SHARE_HEAVY = 0.25;
export const FEE_SHARE_CAUTION = 0.03;

/** Stevie has not yet decided whether a yearly-rate estimate belongs next to factor rates. */
export const SHOW_YEARLY_RATE = true;

export type OfferInput = {
  amount: number; // what the offer says you get
  payback: number; // total you pay back
  fees: number; // taken out up front, so you receive amount - fees
  frequency: Frequency;
  payments: number; // number of payments
  payment?: number; // when the offer states the payment, use it exactly (payments = payback / payment)
  monthlyDeposits?: number; // optional: average monthly deposits
  existingWeekly?: number; // optional: what current advances already take per week
};

export type OfferResult = {
  received: number;
  payback: number;
  cost: number;
  costPerDollar: number;
  costPerMonth: number; // dollars of cost per month of term
  pctCostPerMonth: number; // cost ÷ received ÷ months (how funders quote "% cost per month")
  payment: number;
  payments: number;
  months: number;
  weekly: number;
  monthlyOut: number;
  apr: number | null; // estimated yearly rate as a fraction (0.62 = 62%)
  depositShare: number | null; // this offer's payments / monthly deposits
  combinedShare: number | null; // with existing advances
  feeShare: number;
};

/** Months of term implied by a number of payments at a frequency. */
export function monthsFor(payments: number, frequency: Frequency) {
  return payments / PERIODS_PER_MONTH[frequency];
}

/** Number of payments for a term written the way the offer writes it. */
export function paymentsFor(term: number, unit: TermUnit, frequency: Frequency) {
  if (!(term > 0)) return 0;
  let months: number;
  if (unit === "months") months = term;
  else if (unit === "weeks") months = term / WEEKS_PER_MONTH;
  // "120 days" on a daily-pay offer means 120 business-day payments; otherwise treat days as business days too.
  else months = term / BUSINESS_DAYS_PER_MONTH;
  if (unit === "days" && frequency === "daily") return Math.max(1, Math.round(term));
  if (unit === "weeks" && frequency === "weekly") return Math.max(1, Math.round(term));
  if (unit === "weeks" && frequency === "daily") return Math.max(1, Math.round(term * 5));
  return Math.max(1, Math.round(months * PERIODS_PER_MONTH[frequency]));
}

/** Backwards-compatible helper: a term in months. */
export function paymentsForMonths(months: number, frequency: Frequency) {
  return paymentsFor(months, "months", frequency);
}

/**
 * Estimated APR the way loans are quoted: find the per-period rate r where the payments are
 * worth exactly what you receive today, then annualize (r × periods per year). Returns null
 * when there's no cost or the inputs don't describe a real offer.
 */
export function estimateApr(
  received: number,
  payment: number,
  payments: number,
  frequency: Frequency,
) {
  if (!(received > 0) || !(payment > 0) || !(payments >= 1)) return null;
  if (payment * payments <= received) return null;
  const pv = (r: number) => payment * ((1 - (1 + r) ** -payments) / r);
  let lo = 1e-9;
  let hi = 1;
  while (pv(hi) > received && hi < 1e6) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > received) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * PERIODS_PER_YEAR[frequency];
}

export function checkOffer(o: OfferInput): OfferResult | null {
  const payments = o.payment && o.payment > 0 ? o.payback / o.payment : o.payments;
  if (!(o.amount > 0) || !(o.payback > o.amount * 0.5) || !(payments >= 1)) return null;
  const received = Math.max(0, o.amount - Math.max(0, o.fees));
  const payment = o.payment && o.payment > 0 ? o.payment : o.payback / payments;
  const weekly = payment * PER_WEEK[o.frequency];
  const monthlyOut = payment * PERIODS_PER_MONTH[o.frequency];
  const months = monthsFor(payments, o.frequency);
  const cost = o.payback - received;
  const deposits = o.monthlyDeposits && o.monthlyDeposits > 0 ? o.monthlyDeposits : null;
  const existingMonthly = (o.existingWeekly ?? 0) * WEEKS_PER_MONTH;
  return {
    received,
    payback: o.payback,
    cost,
    costPerDollar: received > 0 ? cost / received : 0,
    costPerMonth: months > 0 ? cost / months : cost,
    pctCostPerMonth: received > 0 && months > 0 ? cost / received / months : 0,
    payment,
    payments,
    months,
    weekly,
    monthlyOut,
    apr: estimateApr(received, payment, payments, o.frequency),
    depositShare: deposits ? monthlyOut / deposits : null,
    combinedShare:
      deposits && existingMonthly > 0 ? (monthlyOut + existingMonthly) / deposits : null,
    feeShare: o.amount > 0 ? Math.max(0, o.fees) / o.amount : 0,
  };
}

// ---------- Comparing saved offers (the side-by-side the funder sites never give you) ----------

export type ComparisonTag = "Lowest cost" | "Longest term" | "Lowest weekly payment" | "Most money";

/** Which saved offer wins on each thing an owner cares about. Ties go to the first. */
export function compareTags(results: OfferResult[]): ComparisonTag[][] {
  const tags: ComparisonTag[][] = results.map(() => []);
  if (results.length < 2) return tags;
  const best = (pick: (r: OfferResult) => number, lower: boolean) => {
    let idx = 0;
    results.forEach((r, i) => {
      const a = pick(r);
      const b = pick(results[idx] as OfferResult);
      if (lower ? a < b : a > b) idx = i;
    });
    return idx;
  };
  tags[best((r) => r.cost, true)]?.push("Lowest cost");
  tags[best((r) => r.months, false)]?.push("Longest term");
  tags[best((r) => r.weekly, true)]?.push("Lowest weekly payment");
  tags[best((r) => r.received, false)]?.push("Most money");
  return tags;
}

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const pct1 = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString("en-US")}%`;
export const months1 = (m: number) => `${Math.round(m * 10) / 10} months`;

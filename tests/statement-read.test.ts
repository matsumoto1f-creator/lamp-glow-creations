// deno test --node-modules-dir=none tests/statement-read.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  dailySeries,
  figures,
  ordinal,
  positions,
  reconcile,
  type StatementRead,
} from "../src/lib/statement-read.ts";

/** Weekdays (Mon to Fri) between two dates, inclusive. */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function month(
  over: Partial<StatementRead> & Pick<StatementRead, "period_start" | "period_end">,
): StatementRead {
  return {
    bank: "Chase",
    account_last4: "4417",
    opening_balance: 10_000,
    closing_balance: 12_000,
    total_deposits: 62_000,
    deposit_count: 48,
    total_withdrawals: 60_000,
    non_revenue_deposits: [
      { date: over.period_start, amount: 2_000, description: "TRANSFER FROM SAV 9921" },
    ],
    nsf_events: [],
    daily_balances: [],
    funder_debits: [],
    incomplete: false,
    ...over,
  };
}

const aug = month({
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  nsf_events: [{ date: "2026-08-14", amount: 35, description: "NSF RETURNED ITEM FEE" }],
});
const sep = month({ period_start: "2026-09-01", period_end: "2026-09-30" });
const oct = month({
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  nsf_events: [
    { date: "2026-10-09", amount: 35, description: "NSF FEE" },
    { date: "2026-10-10", amount: 35, description: "NSF FEE" },
  ],
  funder_debits: [
    {
      description: "FORA FINANCIAL ACH 88213",
      amount: 389,
      dates: weekdays("2026-10-01", "2026-10-31"),
    },
    {
      description: "BLUEVINE CAPITAL WEEKLY",
      amount: 1_250,
      dates: ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
    },
    { description: "INSURANCE PREMIUM", amount: 600, dates: ["2026-10-15"] },
  ],
});

Deno.test("reconcile: opening + deposits - withdrawals = closing, within a dollar", () => {
  assert(reconcile(aug).reconciles);
  assertEquals(
    reconcile(
      month({ period_start: "2026-08-01", period_end: "2026-08-31", closing_balance: 12_000.6 }),
    ).reconciles,
    true,
  );
  const off = reconcile(
    month({ period_start: "2026-08-01", period_end: "2026-08-31", closing_balance: 11_000 }),
  );
  assertEquals(off.reconciles, false);
  assertEquals(off.off_by, 1_000);
  assertEquals(reconcile({ ...aug, incomplete: true }).reconciles, false);
});

Deno.test("daily series: opening balance until the first listed day, then carried forward", () => {
  const r = month({
    period_start: "2026-08-01",
    period_end: "2026-08-05",
    opening_balance: 100,
    daily_balances: [
      { date: "2026-08-02", balance: -50 },
      { date: "2026-08-04", balance: 300 },
    ],
  });
  assertEquals(dailySeries(r), [100, -50, -50, 300, 300]);
  assertEquals(dailySeries({ ...r, daily_balances: [] }), null);
});

Deno.test("positions: a daily and a weekly funder count; a one-off debit is 'other'", () => {
  const p = positions([aug, sep, oct]);
  assertEquals(
    p.map((x) => x.cadence),
    ["daily", "weekly", "other"],
  );
  assertEquals(p[0]!.description, "FORA FINANCIAL ACH 88213");
  assertEquals(p[0]!.monthly, 389 * 21);
  assertEquals(p[1]!.monthly, Math.round(1_250 * 4.33 * 100) / 100);
  assertEquals(p[1]!.last_date, "2026-10-26");
});

Deno.test(
  "positions: only the latest statement counts (a funder paid off earlier isn't open)",
  () => {
    const paidOff = month({
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      funder_debits: [
        { description: "OLD FUNDER", amount: 200, dates: weekdays("2026-07-01", "2026-07-31") },
      ],
    });
    assertEquals(positions([paidOff, aug]).length, 0);
  },
);

Deno.test("figures: a clean three months", () => {
  const f = figures([oct, aug, sep], 60_000, "2026-11-02");
  assert(f.verified);
  assertEquals(f.months, 3);
  assertEquals(f.period_start, "2026-08-01");
  assertEquals(f.period_end, "2026-10-31");
  assertEquals(f.avg_monthly_deposits, 62_000);
  assertEquals(f.avg_monthly_revenue, 60_000);
  assertEquals(f.nsf_total, 3);
  assertEquals(f.nsf_max_month, 2);
  assertEquals(f.position_fit, 3);
  assertEquals(f.holdback, Math.round(((389 * 21 + 1_250 * 4.33) / 60_000) * 1000) / 1000);
  // no daily balances given: unknown, and said so
  assertEquals(f.avg_daily_balance, null);
  assertEquals(f.negative_days, null);
  assertEquals(f.flags, [
    "Daily balances weren't on every statement, so average daily balance and negative days are unknown.",
  ]);
});

Deno.test("figures: average daily balance and negative days across statements", () => {
  const a = month({
    period_start: "2026-09-01",
    period_end: "2026-09-02",
    opening_balance: 1_000,
    daily_balances: [{ date: "2026-09-02", balance: -200 }],
  });
  const b = month({
    period_start: "2026-09-03",
    period_end: "2026-09-04",
    opening_balance: -200,
    daily_balances: [{ date: "2026-09-03", balance: 600 }],
  });
  const f = figures([a, b], null, "2026-09-10");
  assertEquals(f.avg_daily_balance, (1_000 - 200 + 600 + 600) / 4);
  assertEquals(f.negative_days, 1);
});

Deno.test("figures: a statement that doesn't add up makes nothing verified and says so", () => {
  const bad = { ...sep, closing_balance: 9_000 };
  const f = figures([aug, bad, oct], null, "2026-11-02");
  assertEquals(f.verified, false);
  assert(f.flags.some((x) => x.includes("ending 2026-09-30 doesn't add up (off by $3,000)")));
});

Deno.test(
  "figures: flags a missing month, old statements, too few months and a revenue gap",
  () => {
    const f = figures([aug, oct], 100_000, "2026-12-31");
    assert(f.flags.some((x) => x.startsWith("Only 2 months")));
    assert(f.flags.some((x) => x.includes("a month may be missing")));
    assert(f.flags.some((x) => x.includes("ended 2026-10-31")));
    assert(f.flags.some((x) => x.includes("about $60,000 a month; the application says $100,000")));
  },
);

Deno.test("figures: no statements", () => {
  const f = figures([], null, "2026-11-02");
  assertEquals(f.verified, false);
  assertEquals(f.position_fit, 1);
  assertEquals(f.flags, ["No statements could be read."]);
});

Deno.test("ordinal", () => {
  assertEquals([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
  ]);
});

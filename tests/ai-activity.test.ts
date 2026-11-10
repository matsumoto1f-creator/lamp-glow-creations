// deno test --node-modules-dir=none tests/ai-activity.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  type AiUse,
  budgetView,
  draftLine,
  errorLine,
  latest,
  monthStart,
  offReason,
  statementLine,
  summarize,
  usd,
} from "../src/lib/ai-activity.ts";

const now = new Date("2026-11-09T18:00:00Z");
const use = (over: Partial<AiUse>): AiUse => ({
  id: crypto.randomUUID(),
  kind: "statement",
  at: "2026-11-05T14:00:00Z",
  result: "worked",
  error: null,
  cost: 0.4,
  who: "Stevie",
  business: "Blue Door Bakery",
  file_id: "3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b",
  detail: null,
  ...over,
});

Deno.test("the month's totals: each job counted, each on its own budget", () => {
  const m = summarize(
    [
      use({ kind: "statement", cost: 0.4 }),
      use({
        kind: "statement",
        cost: 0.6,
        result: "failed",
        error: "The statement couldn't be read.",
      }),
      use({ kind: "today", cost: 0.05 }),
      use({ kind: "draft", cost: 0.02 }),
      use({ kind: "draft", cost: 0.03 }),
    ],
    now,
  );
  assertEquals(m.uses, 5);
  assertEquals(m.failed, 1);
  assertEquals(m.byKind.statement, { uses: 2, failed: 1, cost: 1 });
  assertEquals(m.byKind.draft.uses, 2);
  // the reader has its own limit; the Today list and drafts share the other
  assertEquals(m.spent.statements, 1);
  assertEquals(Number(m.spent.brain.toFixed(2)), 0.1);
  assertEquals(Number(m.cost.toFixed(2)), 1.1);
});

Deno.test("last month's uses are listed but never counted against this month", () => {
  const old = use({ at: "2026-10-31T23:59:59Z", cost: 9 });
  const first = use({ at: "2026-11-01T00:00:00Z", cost: 1 });
  const m = summarize([old, first], now);
  assertEquals(m.uses, 1);
  assertEquals(m.spent.statements, 1);
  assertEquals(monthStart(now).toISOString(), "2026-11-01T00:00:00.000Z");
});

Deno.test("a list still being written is a use, not a failure; bad costs count as nothing", () => {
  const m = summarize(
    [
      use({ kind: "today", result: "working", cost: 0 }),
      use({ kind: "today", cost: Number.NaN }),
      use({ kind: "today", cost: -3 }),
    ],
    now,
  );
  assertEquals(m.byKind.today, { uses: 3, failed: 0, cost: 0 });
});

Deno.test("the budget bar: fine, nearly gone at 80%, used up at the limit", () => {
  assertEquals(budgetView(0, 50), { fill: 0, left: 50, state: "ok" });
  assertEquals(budgetView(39.99, 50).state, "ok");
  assertEquals(budgetView(40, 50).state, "near");
  assertEquals(budgetView(50, 50), { fill: 1, left: 0, state: "used" });
  assertEquals(budgetView(63, 50), { fill: 1, left: 0, state: "used" });
  // a limit of zero means Claude never runs
  assertEquals(budgetView(0, 0).state, "used");
});

Deno.test("why a job is off: no key first, then the switch", () => {
  assertEquals(offReason(false, ""), "no_key");
  assertEquals(offReason(false, "off"), "no_key");
  assertEquals(offReason(true, " OFF "), "switched_off");
  assertEquals(offReason(true, ""), null);
  assertEquals(offReason(true, "on"), null);
});

Deno.test("dollars read plainly, down to a fraction of a cent", () => {
  assertEquals(usd(0), "$0.00");
  assertEquals(usd(0.0042), "under $0.01");
  assertEquals(usd(0.416), "$0.42");
  assertEquals(usd(12), "$12.00");
  assertEquals(usd(Number.NaN), "$0.00");
});

Deno.test("a statement's line shows the bank, last four and month, and nothing else", () => {
  assertEquals(
    statementLine({
      bank: "Chase",
      account_last4: "1234",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      closing_balance: 18250.11,
      daily_balances: [{ date: "2026-10-02", balance: 900 }],
    }),
    "Chase ••1234, Oct 2026",
  );
  assertEquals(statementLine({ bank: "Chase", account_last4: null, period_end: "" }), "Chase");
  // a last-four that isn't four digits is dropped, not shown
  assertEquals(
    statementLine({ bank: "TD", account_last4: "12345678", period_end: "2026-13-01" }),
    "TD",
  );
  assertEquals(statementLine(null), null);
  assertEquals(statementLine({}), null);
});

Deno.test("a draft says which parts are Claude's words", () => {
  assertEquals(
    draftLine(["text", "email_subject", "email_body", "call"]),
    "Claude wrote the text, the email, the call notes.",
  );
  assertEquals(draftLine(["call"]), "Claude wrote the call notes.");
  assertEquals(draftLine([]), "Claude's wording didn't pass Lamp's check, so Lamp's own was used.");
  assertEquals(
    draftLine(null),
    "Claude's wording didn't pass Lamp's check, so Lamp's own was used.",
  );
  assertEquals(
    draftLine(["something_else"]),
    "Claude's wording didn't pass Lamp's check, so Lamp's own was used.",
  );
});

Deno.test("the list is newest first and capped", () => {
  const a = use({ id: "a", at: "2026-11-01T10:00:00Z" });
  const b = use({ id: "b", at: "2026-11-08T10:00:00Z" });
  const c = use({ id: "c", at: "2026-11-03T10:00:00Z" });
  assertEquals(
    latest([a, b, c]).map((u) => u.id),
    ["b", "c", "a"],
  );
  assertEquals(
    latest([a, b, c], 2).map((u) => u.id),
    ["b", "c"],
  );
});

Deno.test("a failure reads in plain words; Lamp's own sentences pass through", () => {
  const fallback = "Claude couldn't write the draft.";
  assertEquals(errorLine("stop: refusal", fallback), "Claude declined to write this one.");
  assertEquals(errorLine("stop: max_tokens", fallback), "Claude's answer ran too long.");
  assertEquals(errorLine("stop: something_new", fallback), fallback);
  assertEquals(
    errorLine("Anthropic is busy; try again later.", fallback),
    "Anthropic is busy; try again later.",
  );
  assertEquals(errorLine(null, fallback), fallback);
  assertEquals(errorLine("  ", fallback), fallback);
  assertEquals(errorLine("x".repeat(400), fallback).length, 200);
});

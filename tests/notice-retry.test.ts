// deno test --node-modules-dir=none tests/notice-retry.test.ts
// A signed file's new-file email reaches a person even when the browser never asks for it: the
// finish-reminders job tries again, a claim lets only one try send, and every try leaves a record.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  CLAIM_BODY,
  type Delivery,
  mailNotice,
  MAX_FAILED,
  NOTICE,
  type NoticeEvent,
  noticeState,
  noticeSweep,
  pickForRetry,
  RETRY_AFTER_MS,
  RETRY_UNTIL_MS,
  NOTICE_LIMIT_MS,
  sendNoticeOnce,
  type SignedRow,
  STALE_CLAIM_MS,
  type SweepStore,
} from "../src/lib/notice-retry.ts";
import links from "../src/lib/application-links.server.ts" with { type: "text" };
import migration from "../supabase/migrations/20261127100000_unassigned_alerts.sql" with { type: "text" };

const NOW = Date.parse("2026-11-27T15:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/**
 * The file's timeline in memory, holding to the database's one rule: one claim row per file and
 * attempt (events_notice_claim_once).
 */
function memoryStore(signed: SignedRow[] = [], seed: NoticeEvent[] = []) {
  const rows: NoticeEvent[] = seed.map((e) => ({ ...e }));
  let nextId = 1000;
  const calls = { claims: 0, finishes: 0 };
  const store: SweepStore = {
    events(ids) {
      return Promise.resolve(
        rows.filter((e) => ids.includes(e.application_id)).map((e) => ({ ...e })),
      );
    },
    claim(appId, attempt) {
      calls.claims++;
      const clash = rows.some(
        (e) =>
          e.application_id === appId &&
          e.payload?.["notice_claim"] === NOTICE &&
          Number(e.payload?.["attempt"] ?? 0) === attempt,
      );
      if (clash) return Promise.resolve("taken" as const);
      const id = nextId++;
      rows.push({
        id,
        application_id: appId,
        created_at: new Date(NOW).toISOString(),
        payload: { notice_claim: NOTICE, attempt },
      });
      return Promise.resolve(id);
    },
    finish(id, _body, payload) {
      calls.finishes++;
      const row = rows.find((e) => e.id === id);
      if (!row) return Promise.resolve(false);
      row.payload = payload;
      return Promise.resolve(true);
    },
    signed() {
      // every row, whatever the window: the job's own filter is what is under test
      return Promise.resolve(signed);
    },
  };
  return { store, rows, calls };
}

const sent: Delivery = { ok: true, body: "Emailed the signed application to a@b.co.", payload: {} };
const failed = (n: number, app: string): NoticeEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: 100 + i,
    application_id: app,
    created_at: ago(30 * MIN),
    payload: { notice_failed: NOTICE, error: "Gmail 500", notice_claim: NOTICE, attempt: i },
  }));

Deno.test("windows: the job looks from 10 minutes to 47 hours, inside the 48 hour limit", () => {
  assertEquals(RETRY_AFTER_MS, 10 * MIN);
  assertEquals(RETRY_UNTIL_MS, 47 * HOUR);
  assert(RETRY_UNTIL_MS < NOTICE_LIMIT_MS);
  assertEquals(MAX_FAILED, 2);
  // the server's own refusal uses the same limit
  assert(links.includes("Date.now() - Date.parse(d.signed_at) > NOTICE_LIMIT_MS"));
});

Deno.test("state: sent, failed tries, open claims and the next attempt", () => {
  const s = noticeState([
    ...failed(2, "a"),
    {
      id: 9,
      application_id: "a",
      created_at: ago(MIN),
      payload: { notice_claim: NOTICE, attempt: 2 },
    },
  ]);
  assertEquals(s.sent, false);
  assertEquals(s.failed, 2);
  assertEquals(
    s.open.map((e) => e.id),
    [9],
  );
  assertEquals(s.next, 3);
  // a notice written before claims existed still counts as sent
  assert(
    noticeState([{ id: 1, application_id: "a", created_at: ago(MIN), payload: { notice: NOTICE } }])
      .sent,
  );
  assertEquals(noticeState([]).next, 0);
});

Deno.test(
  "sweep: only files signed 10 min to 47 h ago, with fewer than 3 failures, unclaimed",
  async () => {
    const signed: SignedRow[] = [
      { application_id: "too-new", signed_at: ago(5 * MIN) },
      { application_id: "fresh", signed_at: ago(11 * MIN) },
      { application_id: "old", signed_at: ago(46 * HOUR) },
      { application_id: "too-old", signed_at: ago(47 * HOUR + MIN) },
      { application_id: "two-failed", signed_at: ago(2 * HOUR) },
      { application_id: "three-failed", signed_at: ago(2 * HOUR) },
      { application_id: "emailed", signed_at: ago(2 * HOUR) },
      { application_id: "sending", signed_at: ago(2 * HOUR) },
    ];
    const { store } = memoryStore(signed, [
      ...failed(2, "two-failed"),
      ...failed(3, "three-failed"),
      { id: 1, application_id: "emailed", created_at: ago(HOUR), payload: { notice: NOTICE } },
      // another try claimed it a minute ago and is still sending
      {
        id: 2,
        application_id: "sending",
        created_at: ago(MIN),
        payload: { notice_claim: NOTICE, attempt: 0 },
      },
    ]);
    const tried: string[] = [];
    const r = await noticeSweep(store, NOW, (id) => {
      tried.push(id);
      return Promise.resolve({ kind: "sent" });
    });
    // the oldest first
    assertEquals(tried, ["old", "two-failed", "fresh"]);
    assertEquals(r.sent, 3);
    assertEquals(r.stale, 0);
  },
);

Deno.test("sweep: at most the per-run cap, the rest next run", async () => {
  const signed = Array.from({ length: 8 }, (_, i) => ({
    application_id: `f${i}`,
    signed_at: ago((20 + i) * MIN),
  }));
  const tried: string[] = [];
  const { store } = memoryStore(signed);
  await noticeSweep(
    store,
    NOW,
    (id) => {
      tried.push(id);
      return Promise.resolve({ kind: "sent" });
    },
    3,
  );
  assertEquals(tried, ["f7", "f6", "f5"]);
  // the default cap is five
  assertEquals(pickForRetry(signed, [], NOW).send.length, 5);
});

Deno.test("sweep: a claim that never got a result is written off, then tried again", async () => {
  const signed = [{ application_id: "stuck", signed_at: ago(3 * HOUR) }];
  const { store, rows } = memoryStore(signed, [
    {
      id: 5,
      application_id: "stuck",
      created_at: ago(STALE_CLAIM_MS + MIN),
      payload: { notice_claim: NOTICE, attempt: 0 },
    },
  ]);
  const tried: string[] = [];
  const send = (id: string) => {
    tried.push(id);
    return sendNoticeOnce(store, id, () => Promise.resolve(sent));
  };
  const first = await noticeSweep(store, NOW, send);
  assertEquals(first.stale, 1);
  assertEquals(tried, []);
  assertEquals(rows[0]!.payload?.["notice_failed"], NOTICE);
  // next run: a new attempt number, so the claim is free, and the email goes
  const second = await noticeSweep(store, NOW, send);
  assertEquals(second.sent, 1);
  const sentRow = rows.find((e) => e.payload?.["notice"] === NOTICE)!;
  assertEquals(sentRow.payload?.["attempt"], 1);
});

Deno.test("claim: a second sender after a claim does nothing", async () => {
  const { store, rows } = memoryStore();
  let release: (d: Delivery) => void = () => {};
  let firstCalls = 0;
  const first = sendNoticeOnce(store, "app", () => {
    firstCalls++;
    return new Promise<Delivery>((r) => (release = r));
  });
  // let the first try take its claim
  await new Promise((r) => setTimeout(r, 0));
  let secondCalls = 0;
  const second = await sendNoticeOnce(store, "app", () => {
    secondCalls++;
    return Promise.resolve(sent);
  });
  assertEquals(second.kind, "busy");
  assertEquals(secondCalls, 0);
  release(sent);
  assertEquals((await first).kind, "sent");
  assertEquals(firstCalls, 1);
  // one row, the claim turned into the record of what was sent
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.payload?.["notice"], NOTICE);
  // and once sent, nobody sends again
  const third = await sendNoticeOnce(store, "app", () => Promise.resolve(sent));
  assertEquals(third.kind, "already");
});

Deno.test(
  "claim: two senders that both read before either claims; the database lets one in",
  async () => {
    const { store, calls } = memoryStore();
    let sends = 0;
    const deliver = () => {
      sends++;
      return Promise.resolve(sent);
    };
    const [a, b] = await Promise.all([
      sendNoticeOnce(store, "app", deliver),
      sendNoticeOnce(store, "app", deliver),
    ]);
    assertEquals([a.kind, b.kind].sort(), ["busy", "sent"]);
    assertEquals(sends, 1);
    assertEquals(calls.claims, 2);
  },
);

Deno.test("Google: a token fetch that throws is recorded as a failed try", async () => {
  const { store, rows } = memoryStore();
  let gmailCalls = 0;
  const out = await sendNoticeOnce(store, "app", async () => {
    const m = await mailNotice(
      () => Promise.reject(new Error("token endpoint down")),
      () => {
        gmailCalls++;
        return Promise.resolve({ ok: true, status: 200 });
      },
    );
    return m.ok ? sent : m;
  });
  assertEquals(out, { kind: "failed", why: "Couldn't reach Google." });
  assertEquals(gmailCalls, 0);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.payload?.["notice_failed"], NOTICE);
  assertEquals(rows[0]!.payload?.["error"], "Couldn't reach Google.");
  // the job tries again next run with the next attempt number
  assertEquals(noticeState(rows).next, 1);
});

Deno.test("Gmail: a refused send and a send that throws keep their reason", async () => {
  assertEquals(
    await mailNotice(
      () => Promise.resolve({ access: "t" }),
      () => Promise.resolve({ ok: false, status: 429 }),
    ),
    { ok: false, why: "Gmail 429" },
  );
  assertEquals(
    await mailNotice(
      () => Promise.resolve({ access: "t" }),
      () => Promise.reject(new Error("offline")),
    ),
    { ok: false, why: "couldn't reach Gmail" },
  );
  assertEquals(
    await mailNotice(
      () => Promise.resolve({ error: "Mailbox not connected." }),
      () => Promise.resolve({ ok: true, status: 200 }),
    ),
    { ok: false, why: "Mailbox not connected." },
  );
});

Deno.test("deliver: anything else that throws is still written on the file", async () => {
  const { store, rows } = memoryStore();
  const out = await sendNoticeOnce(store, "app", () => Promise.reject(new Error("storage")));
  assertEquals(out.kind, "failed");
  assertEquals(rows[0]!.payload?.["notice_failed"], NOTICE);
});

Deno.test("server: the route and the job share one sender, wired to the claim", () => {
  const route = links.slice(
    links.indexOf("export async function notifyNewApplication("),
    links.indexOf("export async function sendNewApplicationNotice("),
  );
  // the route proves the caller, then hands over
  assert(
    route.indexOf("if (!allowed) return json(404") <
      route.indexOf("sendNewApplicationNotice(svc, appId"),
  );
  const fn = links.slice(links.indexOf("export async function sendNewApplicationNotice("));
  assert(fn.includes("sendNoticeOnce(noticeStore(svc), appId"));
  // the Google token can't throw past the record any more
  assert(fn.includes("mailNotice("));
  assert(!/const access = await gmailAccessToken\(svc\);/.test(fn));
  // a clash on the claim index is "taken", not an error
  assert(fn.includes('r.error?.code === "23505"'));
  assert(fn.includes("body: CLAIM_BODY") || links.includes("body: CLAIM_BODY"));
  assert(CLAIM_BODY.length > 0);
});

Deno.test("migration: one claim per file and attempt", () => {
  assert(migration.includes("create unique index if not exists events_notice_claim_once"));
  assert(migration.includes("where payload ? 'notice_claim'"));
  assert(migration.includes("(coalesce(payload ->> 'attempt', '0'))"));
});

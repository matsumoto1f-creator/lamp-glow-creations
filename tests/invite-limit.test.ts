// deno test --node-modules-dir=none tests/invite-limit.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  DAILY_EMAILS,
  dailyEmailLimit,
  emailedToday,
  limitReached,
  newYorkDayStart,
  ONCE_A_DAY,
  roomLeft,
} from "../src/lib/invite-limit.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };

Deno.test("a rep may send 30 application emails a day, an admin 100", () => {
  assertEquals(DAILY_EMAILS, { rep: 30, admin: 100 });
  assertEquals(dailyEmailLimit(false), 30);
  assertEquals(dailyEmailLimit(true), 100);
});

Deno.test("room left never goes below zero and ignores a bad count", () => {
  assertEquals(roomLeft(30, 0), 30);
  assertEquals(roomLeft(30, 29), 1);
  assertEquals(roomLeft(30, 30), 0);
  assertEquals(roomLeft(30, 45), 0);
  assertEquals(roomLeft(30, -3), 30);
});

Deno.test("the limit message says the number and what to do instead", () => {
  const m = limitReached(30);
  assert(m.includes("30"));
  assert(m.toLowerCase().includes("copy the link"));
  assert(!/\bloans?\b/i.test(m));
});

Deno.test("the day starts at midnight in New York, in winter and in summer", () => {
  // 10:00 EST (UTC-5)
  assertEquals(
    newYorkDayStart(new Date("2026-11-14T15:00:00Z")).toISOString(),
    "2026-11-14T05:00:00.000Z",
  );
  // 23:59 EST is still the same day, though it is already the 15th in UTC
  assertEquals(
    newYorkDayStart(new Date("2026-11-15T04:59:59Z")).toISOString(),
    "2026-11-14T05:00:00.000Z",
  );
  // one second later it is the 15th in New York
  assertEquals(
    newYorkDayStart(new Date("2026-11-15T05:00:00Z")).toISOString(),
    "2026-11-15T05:00:00.000Z",
  );
  // 12:00 EDT (UTC-4)
  assertEquals(
    newYorkDayStart(new Date("2026-07-04T16:00:00Z")).toISOString(),
    "2026-07-04T04:00:00.000Z",
  );
});

Deno.test("the day start is right on the days the clocks change", () => {
  // 2026-11-01: midnight was EDT (04:00Z); by 10:00 the clocks are EST
  assertEquals(
    newYorkDayStart(new Date("2026-11-01T15:00:00Z")).toISOString(),
    "2026-11-01T04:00:00.000Z",
  );
  // 2026-03-08: midnight was EST (05:00Z); by noon the clocks are EDT
  assertEquals(
    newYorkDayStart(new Date("2026-03-08T16:00:00Z")).toISOString(),
    "2026-03-08T05:00:00.000Z",
  );
});

Deno.test("the server checks the limit on both ways an email goes out", () => {
  // the count of today's emails is by the person pressing Send, emails only, since New York midnight
  assert(/\.eq\("sent_by", userId\)/.test(server));
  assert(/\.eq\("channel", "email"\)/.test(server));
  assert(/\.gte\("sent_at", newYorkDayStart\(/.test(server));
  // resending an old link by email is refused once the day's emails are used up
  const resend = server.slice(
    server.indexOf('body.action === "resend"'),
    server.indexOf('body.action !== "send"'),
  );
  assert(resend.includes("emailsSentToday(svc, who.userId)"));
  assert(resend.includes("json(429, { error: limitReached(limit) })"));
  // a batch skips the emails past the limit, and counts each one before it is sent
  const send = server.slice(server.indexOf('body.action !== "send"'));
  assert(send.includes("emailRoom = roomLeft(emailLimit, sentToday)"));
  const skip = send.indexOf("detail: limitReached(emailLimit)");
  const insert = send.indexOf('.from("application_invites")\n      .insert(');
  assert(
    skip > 0 && insert > skip,
    "the limit is checked before the row is written or the email sent",
  );
  const counted = send.indexOf("emailRoom--");
  assert(counted > skip && counted < insert, "each email is counted before it is sent");
});

// ---------- "fill it in with them now", then Email: once a day per address ----------

Deno.test(
  "an address emailed earlier today (New York) can't be emailed again until tomorrow",
  () => {
    // Monday 2026-11-23, 15:00 New York (20:00 UTC)
    const now = new Date("2026-11-23T20:00:00Z");
    assert(emailedToday("2026-11-23T05:00:01Z", now)); // 00:00:01 New York
    assert(emailedToday("2026-11-23T19:59:00Z", now));
    assert(!emailedToday("2026-11-23T04:59:59Z", now)); // 23:59:59 the night before
    assert(!emailedToday(null, now));
    assert(!emailedToday(undefined, now));
    assert(!emailedToday("not a time", now));
    assert(ONCE_A_DAY.includes("today") && !/loan/i.test(ONCE_A_DAY));
  },
);

Deno.test("the draft Email checks the address before sending, and stamps the send", () => {
  const start = server.indexOf("export async function applicationDraft");
  const draft = server.slice(start, server.indexOf("// ---------- POST /api/application/submit"));
  const check = draft.indexOf("emailedToday(last, new Date())");
  const refuse = draft.indexOf("json(429, { error: ONCE_A_DAY })");
  const send = draft.indexOf("gmailSend(");
  assert(
    check > 0 && refuse > check && send > refuse,
    "checked and refused before Gmail is called",
  );
  // a failed lookup stops the send instead of letting it through
  assert(draft.includes("if (last === undefined) return tryAgain();"));
  // the send is stamped so the next check, and the sender's daily count, see it
  const after = draft.slice(send);
  assert(after.includes("sent_at: new Date().toISOString()"));
  assert(after.includes("sent_by: who.userId"));
});

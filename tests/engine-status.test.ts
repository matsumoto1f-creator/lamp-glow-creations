// deno test --node-modules-dir=none tests/engine-status.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  dayLine,
  engineClock,
  engineDay,
  freshness,
  hourWords,
  jobState,
  mailboxDay,
  MAX_BYTES,
  parseStatus,
  windowWords,
  type Job,
  type Snapshot,
} from "../src/lib/engine-status.ts";

// the shape outreach/emailkit/autopilot.py posts (status.json), as it looked on its first real run
const snap = (over: Record<string, unknown> = {}) => ({
  key: "lamp-email",
  offer: "lamp",
  built_at: "2026-11-12T08:31:04",
  autopilot_on: true,
  delivery: "draft",
  tests: "daily_sample",
  daily_cap: 90,
  senders: [
    {
      key: "asad",
      name: "Asad Matsumoto",
      mailbox: "partners@getlamp.app",
      on: true,
      connected: true,
      cap: 30,
      used: 30,
      why: "",
    },
    {
      key: "stevie",
      name: "Stevie Marshall",
      mailbox: "marshall@getlamp.app",
      on: true,
      connected: false,
      cap: 30,
      used: 0,
      why: "mailbox not signed in to gog yet",
    },
    {
      key: "zeus",
      name: "Zeus",
      mailbox: "zeus@getlamp.app",
      on: false,
      connected: false,
      cap: 30,
      used: 0,
      why: "not on autopilot",
    },
  ],
  jobs: [
    {
      label: "com.ket.lamp-email-research",
      step: "research",
      title: "Lead researcher",
      what: "reads websites",
      schedule: "Every day 05:30",
      next_run: "2026-11-13T05:30:00",
      state: "on",
      last: {
        started_at: "2026-11-12T05:30:00",
        ended_at: "2026-11-12T05:52:10",
        ok: true,
        summary: "researched 150 businesses",
      },
    },
    {
      label: "com.ket.lamp-email-drafts",
      step: "morning",
      title: "Email drafter",
      what: "writes drafts",
      schedule: "Mon-Fri 08:30",
      next_run: "2026-11-13T08:30:00",
      state: "on",
      last: null,
    },
    {
      label: "com.ket.lamp-email-replies",
      step: "replies",
      title: "Reply checker",
      what: "reads replies",
      schedule: "Mon-Fri 09:30 · 13:00 · 16:30",
      next_run: "",
      state: "paused",
      last: {
        started_at: "2026-11-11T21:46:53",
        ended_at: "2026-11-11T21:46:53",
        ok: false,
        summary: "reply check FAILED",
      },
    },
  ],
  today: { first_emails_drafted: 30, first_emails_sent: 4, followups_drafted: 0, replies: 1 },
  totals: {
    first_emails_drafted: 30,
    first_emails_sent: 4,
    waiting_in_drafts: 26,
    replied: 1,
    bounced: 0,
    bounce_rate: 0,
    followups_sent: 0,
  },
  queue: {
    ranked: 500,
    emailed: 30,
    waiting: 470,
    researched_waiting: 470,
    personal_lines_waiting: 170,
    industries: { other: 220, construction: 70, food: 20 },
  },
  blocked: ["Stevie Marshall's mailbox (marshall@getlamp.app): mailbox not signed in to gog yet"],
  lists: [
    { name: "ttc_lsa_valid", label: "Stevie: LSA list with revenue", mode: "on", daily_cap: null },
  ],
  recent: [
    {
      at: "2026-11-12T08:30:00",
      step: "morning",
      ok: true,
      summary: "30 first emails put in Drafts",
    },
  ],
  reply_check: { ran_at: "2026-11-12T08:30:10", ok: true, portal_waiting: 0 },
  portal: { pushed_at: "2026-11-12T08:31:04", ok: true, error: "" },
  ...over,
});

Deno.test("parse: the engine's snapshot goes in whole, with only the fields the page shows", () => {
  const r = parseStatus({ snapshot: snap() });
  assert("snapshot" in r);
  const s = r.snapshot;
  assertEquals(s.key, "lamp-email");
  assertEquals(
    s.senders.map((m) => [m.key, m.used, m.cap]),
    [
      ["asad", 30, 30],
      ["stevie", 0, 30],
      ["zeus", 0, 30],
    ],
  );
  assertEquals(
    s.jobs.map((j) => j.state),
    ["on", "on", "paused"],
  );
  assertEquals(s.jobs[1].last, null);
  assertEquals(
    s.queue.industries.map((x) => x.key),
    ["other", "construction", "food"],
  );
  assertEquals(s.totals.waiting_in_drafts, 26);
  assertEquals("portal" in s, false); // fields the page does not show are dropped, never stored
  assertEquals("offer" in s, false);
});

Deno.test("parse: what cannot be shown is refused whole, with the reason", () => {
  assertEquals(parseStatus({}), { problem: "Send { snapshot: {...} }." });
  assert("problem" in parseStatus({ snapshot: snap({ key: "other-engine" }) }));
  assert("problem" in parseStatus({ snapshot: snap({ built_at: "this morning" }) }));
  assert(
    "problem" in
      parseStatus({ snapshot: snap({ blocked: Array(20).fill("x".repeat(MAX_BYTES)) }) }),
  );
});

Deno.test("parse: bad values are made safe, not trusted", () => {
  const r = parseStatus({
    snapshot: snap({
      daily_cap: -5,
      senders: [{ key: "asad", cap: "lots", used: Infinity, on: "yes" }],
      jobs: [{ label: "x", state: "running", next_run: "soon", last: { ok: "true", summary: 7 } }],
      totals: { bounce_rate: 4 },
      blocked: ["", "  real reason  ", 3],
      lists: [{ name: "a", mode: "maybe", daily_cap: null }],
    }),
  });
  assert("snapshot" in r);
  const s = r.snapshot;
  assertEquals(s.daily_cap, 0);
  assertEquals([s.senders[0].cap, s.senders[0].used, s.senders[0].on], [0, 0, false]);
  assertEquals([s.jobs[0].state, s.jobs[0].next_run, s.jobs[0].last?.ok], ["off", "", false]);
  assertEquals(s.totals.bounce_rate, 1);
  assertEquals(s.blocked, ["real reason", "3"]);
  assertEquals([s.lists[0].mode, s.lists[0].daily_cap], ["on", null]);
});

Deno.test("parse: long lists are cut to size", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    at: "2026-11-12T08:30:00",
    step: "morning",
    ok: true,
    summary: `run ${i}`,
  }));
  const r = parseStatus({
    snapshot: snap({ recent: many, senders: Array(30).fill(snap().senders[0]) }),
  });
  assert("snapshot" in r);
  assertEquals(r.snapshot.recent.length, 20);
  assertEquals(r.snapshot.senders.length, 10);
});

Deno.test(
  "freshness: from the server's receipt time; a day and a bit is fresh, three days late, older or unreadable stale",
  () => {
    const now = new Date("2026-11-13T15:00:00Z");
    assertEquals(freshness("2026-11-12T13:31:00+00:00", now), "fresh");
    assertEquals(freshness("2026-11-11T13:31:00+00:00", now), "late");
    assertEquals(freshness("2026-11-09T13:31:00+00:00", now), "stale");
    assertEquals(freshness(null, now), "stale");
    assertEquals(freshness("", now), "stale");
  },
);

Deno.test("job state: off, paused, never run, worked, failed", () => {
  const j = (over: Partial<Job>): Job => ({
    label: "x",
    step: "s",
    title: "t",
    what: "",
    schedule: "",
    next_run: "",
    state: "on",
    last: null,
    ...over,
  });
  assertEquals(jobState(j({ state: "off" })).label, "Off");
  assertEquals(jobState(j({ state: "paused" })).label, "Paused");
  assertEquals(jobState(j({})).label, "Not run yet");
  assertEquals(
    jobState(j({ last: { started_at: "", ended_at: "", ok: true, summary: "" } })).tone,
    "ok",
  );
  assertEquals(
    jobState(j({ last: { started_at: "", ended_at: "", ok: false, summary: "" } })).tone,
    "bad",
  );
});

Deno.test("engine times read as New York clock time whatever the viewer's zone", async () => {
  const { engineTime, engineNow, runState } = await import("../src/lib/engine-status.ts");
  const now = new Date("2026-11-12T14:00:00Z"); // 9:00 AM in New York
  assertEquals(engineNow(now), "2026-11-12T09:00");
  assertEquals(engineTime("2026-11-11T21:47:30", now), "Wed 9:47 PM ET");
  assertEquals(engineTime("2026-11-12T00:05:00", now), "Thu 12:05 AM ET");
  assertEquals(engineTime("2026-11-03T08:30:00", now), "Nov 3, 8:30 AM ET");
  assertEquals(engineTime("", now), "");
  assertEquals(runState("2026-11-12T08:30:00", now), "running"); // 30 minutes past: the drafter is likely running
  assertEquals(runState("2026-11-12T04:30:00", now), "overdue"); // 4.5 hours past: the Mac was asleep
  assertEquals(runState("2026-11-12T09:30:00", now), "");
  assertEquals(runState("", now), "");
});

Deno.test("a missing daily cap stays missing, never 0", () => {
  const r = parseStatus({ snapshot: snap({ daily_cap: null }) });
  assert("snapshot" in r);
  assertEquals(r.snapshot.daily_cap, null);
});

Deno.test(
  "mailbox state and kill switch come through; an old snapshot without them is read safely",
  () => {
    const withState = parseStatus({
      snapshot: snap({
        senders: [
          {
            key: "asad",
            name: "A",
            mailbox: "a@x",
            on: true,
            connected: true,
            cap: 30,
            used: 0,
            why: "",
            state: "held",
          },
          {
            key: "zeus",
            name: "Z",
            mailbox: "z@x",
            on: false,
            connected: false,
            cap: 30,
            used: 0,
            why: "not on autopilot",
          },
        ],
        kill: { max_bounce_rate: 0.05, min_sends: 20 },
      }),
    });
    assert("snapshot" in withState);
    assertEquals(
      withState.snapshot.senders.map((m) => m.state),
      ["held", "off"],
    );
    assertEquals(withState.snapshot.kill, { max_bounce_rate: 0.05, min_sends: 20 });
    const old = parseStatus({ snapshot: snap() });
    assert("snapshot" in old);
    assertEquals(old.snapshot.senders[0].state, "held"); // no state sent: never shown as drafting by default
    assertEquals(old.snapshot.kill, { max_bounce_rate: null, min_sends: null });
  },
);

// 2026-11-12: the per-mailbox warm-up ramp, as outreach/emailkit/autopilot.py ramp_public() sends it
const ramp = {
  day: 3,
  step: 1,
  steps: 4,
  cap: 5,
  full_cap: 30,
  next_cap: 10,
  next_day: 6,
  held: false,
  restarted: false,
  limiting: true,
  words: "Warm-up day 3: 5 a day, 10 a day from sending day 6",
};
const withRamp = (r: unknown) =>
  snap({ senders: [{ ...snap().senders[0], cap: 5, used: 5, ramp: r }, snap().senders[1]] });

Deno.test("ramp: each mailbox's warm-up comes through with the fields the page shows", () => {
  const r = parseStatus({ snapshot: withRamp(ramp) });
  if (!("snapshot" in r)) throw new Error(r.problem);
  assertEquals(r.snapshot.senders[0].ramp, {
    day: 3,
    cap: 5,
    next_cap: 10,
    next_day: 6,
    limiting: true,
    held: false,
    restarted: false,
    words: "Warm-up day 3: 5 a day, 10 a day from sending day 6",
  });
  assertEquals(r.snapshot.senders[0].cap, 5);
});

Deno.test(
  "ramp: none sent, or not an object, reads as no ramp; a snapshot from before the ramp still parses",
  () => {
    for (const bad of [undefined, null, [], "5 a day", 5]) {
      const r = parseStatus({ snapshot: withRamp(bad) });
      if (!("snapshot" in r)) throw new Error(r.problem);
      assertEquals(r.snapshot.senders[0].ramp, null);
    }
    const old = parseStatus({ snapshot: snap() });
    if (!("snapshot" in old)) throw new Error(old.problem);
    assertEquals(
      old.snapshot.senders.map((m) => m.ramp),
      [null, null, null],
    );
  },
);

Deno.test("ramp: bad values are made safe, a top step has no next one", () => {
  const r = parseStatus({
    snapshot: withRamp({
      day: -4,
      cap: "lots",
      next_cap: null,
      next_day: undefined,
      limiting: "yes",
      held: 1,
      restarted: true,
      words: "x".repeat(900),
    }),
  });
  if (!("snapshot" in r)) throw new Error(r.problem);
  const m = r.snapshot.senders[0].ramp!;
  assertEquals(
    [m.day, m.cap, m.next_cap, m.next_day, m.limiting, m.held, m.restarted],
    [0, 0, null, null, false, false, true],
  );
  assertEquals(m.words.length, 300);
});

// ---- 2026-11-16: the page says which day it means, what went out, what waits and when the next emails are written ----
// The real morning: review mode, three mailboxes on warm-up day 1 (5 a day), the drafting job ran at 08:59 and runs next Tue 08:30.
const RAMP = {
  day: 1,
  step: 1,
  steps: 4,
  cap: 5,
  full_cap: 30,
  next_cap: 10,
  next_day: 6,
  held: false,
  restarted: false,
  limiting: true,
  words: "Warm-up day 1: 5 a day, 10 a day from sending day 6",
};
const box = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  name: key,
  mailbox: `${key}@getlamp.app`,
  on: true,
  connected: true,
  cap: 5,
  used: 5,
  why: "",
  state: "drafting",
  ramp: RAMP,
  sent_today: 5,
  waiting: 0,
  ...over,
});
const morningJob = (over: Record<string, unknown> = {}) => ({
  label: "com.ket.lamp-email-drafts",
  step: "morning",
  title: "Email drafter",
  what: "writes",
  schedule: "Mon-Fri 08:30",
  next_run: "2026-11-17T08:30:00",
  state: "on",
  last: {
    started_at: "2026-11-16T08:59:46",
    ended_at: "2026-11-16T09:00:02",
    ok: true,
    summary: "15 waiting",
  },
  ...over,
});
const day = (senders: unknown[], over: Record<string, unknown> = {}): Snapshot => {
  const r = parseStatus({
    snapshot: snap({
      delivery: "review",
      window: "Mon-Fri 09:00-17:00 America/New_York",
      senders,
      jobs: [morningJob()],
      ...over,
    }),
  });
  if ("problem" in r) throw new Error(r.problem);
  return r.snapshot;
};
const MON_0915 = new Date("2026-11-16T14:15:00Z"); // 9:15 AM in New York

Deno.test("day words: dates, clock times and sending hours read as plain words", () => {
  assertEquals(engineDay("2026-11-16T08:30:00"), "Mon Nov 16");
  assertEquals(engineDay("2026-11-17"), "Tue Nov 17");
  assertEquals(engineDay("soon"), "");
  assertEquals(engineClock("2026-11-17T08:30:00"), "8:30 AM ET");
  assertEquals(engineClock("2026-11-17T16:05"), "4:05 PM ET");
  assertEquals(
    windowWords("Mon-Fri 09:00-17:00 America/New_York"),
    "Mon-Fri, 9:00 AM to 5:00 PM ET",
  );
  assertEquals(windowWords("weekdays, mornings"), "weekdays, mornings"); // an unknown form is shown as written, never guessed
  assertEquals(windowWords(""), "");
});

Deno.test(
  "parse: sent today, waiting and the sending hours come through; an older engine's snapshot leaves them unknown",
  () => {
    const s = day([box("asad", { sent_today: 2, waiting: 3 })]);
    assertEquals(
      [s.senders[0].sent_today, s.senders[0].waiting, s.window],
      [2, 3, "Mon-Fri 09:00-17:00 America/New_York"],
    );
    const old = parseStatus({ snapshot: snap() });
    assert("snapshot" in old);
    assertEquals(
      [old.snapshot.senders[0].sent_today, old.snapshot.senders[0].waiting, old.snapshot.window],
      [null, null, ""],
    );
  },
);

Deno.test(
  "mailbox: everything sent says done for today, names the day, and says when the next emails are written",
  () => {
    const s = day([box("asad")]);
    const d = mailboxDay(s.senders[0], s, MON_0915);
    assertEquals(d.pill, "Done for today");
    assertEquals(d.tone, "ok");
    assertEquals(d.today, "Today, Mon Nov 16: all 5 sent. This mailbox is finished for today.");
    assertEquals(
      d.next,
      "Next: Tue Nov 17 at 8:30 AM ET, up to 5 more are written and wait for your approval at the top of this page.",
    );
    assertEquals([d.sent, d.waiting], [5, 0]);
  },
);

Deno.test("mailbox: emails waiting on a person say so, and say where", () => {
  const s = day([box("asad", { sent_today: 0, waiting: 5 })]);
  const d = mailboxDay(s.senders[0], s, MON_0915);
  assertEquals(d.pill, "Waiting for your approval");
  assertEquals(d.tone, "warn");
  assertEquals(
    d.today,
    "Today, Mon Nov 16: 0 sent, 5 waiting for your approval at the top of this page.",
  );
  // draft mode waits in Gmail, not in the portal
  const dm = day([box("asad", { sent_today: 1, waiting: 4 })], { delivery: "draft" });
  const g = mailboxDay(dm.senders[0], dm, MON_0915);
  assertEquals(g.pill, "Waiting in Drafts");
  assert(g.today.endsWith("1 sent, 4 waiting in Gmail Drafts for the rep to send."));
  assert(g.next.endsWith("go into this mailbox's Gmail Drafts."));
});

Deno.test(
  "mailbox: fewer sent than the limit and nothing waiting is still finished, with the real numbers",
  () => {
    const s = day([box("asad", { sent_today: 3, waiting: 0 })]);
    assertEquals(
      mailboxDay(s.senders[0], s, MON_0915).today,
      "Today, Mon Nov 16: 3 sent of a limit of 5. Nothing else is waiting, so this mailbox is finished for today.",
    );
  },
);

Deno.test(
  "mailbox: before the morning run it says when today's are written; on a day with no run it says none are",
  () => {
    const before = day([box("asad", { sent_today: 0, waiting: 0, used: 0 })], {
      jobs: [morningJob({ next_run: "2026-11-16T08:30:00", last: null })],
    });
    const b = mailboxDay(before.senders[0], before, new Date("2026-11-16T12:00:00Z")); // 7:00 AM in New York
    assertEquals(b.pill, "Not written yet");
    assertEquals(
      b.today,
      "Today, Mon Nov 16: nothing written yet. Up to 5 are written at 8:30 AM ET and then wait for your approval at the top of this page.",
    );
    assertEquals(b.next, "");
    const sat = day([box("asad", { sent_today: 0, waiting: 0, used: 0 })], {
      jobs: [
        morningJob({
          last: {
            started_at: "2026-11-13T08:30:05",
            ended_at: "2026-11-13T08:31:00",
            ok: true,
            summary: "x",
          },
          next_run: "2026-11-16T08:30:00",
        }),
      ],
    });
    const w = mailboxDay(sat.senders[0], sat, new Date("2026-11-14T15:00:00Z")); // Saturday
    assertEquals(w.pill, "Nothing today");
    assertEquals(w.today, "Today, Sat Nov 14: no emails are written today.");
    assertEquals(
      w.next,
      "Next: Mon Nov 16 at 8:30 AM ET, up to 5 more are written and wait for your approval at the top of this page.",
    );
    // the run happened and wrote nothing for this mailbox: it points at the run's own words, it does not guess a reason
    const none = day([box("asad", { sent_today: 0, waiting: 0, used: 0 })]);
    assert(
      mailboxDay(none.senders[0], none, MON_0915).today.includes(
        "no email was written for this mailbox",
      ),
    );
  },
);

Deno.test("mailbox: held and off say so; a paused autopilot promises nothing next", () => {
  const s = day([
    box("zeus", { state: "held", why: "no phone number", sent_today: 0, waiting: 0 }),
    box("x", { on: false, state: "off" }),
  ]);
  const h = mailboxDay(s.senders[0], s, MON_0915);
  assertEquals([h.pill, h.tone, h.next], ["Held", "warn", ""]);
  assert(h.today.startsWith("Today, Mon Nov 16: nothing is written from this mailbox until"));
  assertEquals(mailboxDay(s.senders[1], s, MON_0915).pill, "Not on autopilot");
  const p = day([box("asad")], { autopilot_on: false });
  assertEquals(
    mailboxDay(p.senders[0], p, MON_0915).next,
    "Next: nothing while autopilot is paused.",
  );
});

Deno.test(
  "mailbox: the next day's number follows the warm-up, and today's sends earn the next day",
  () => {
    const up = { ...RAMP, day: 5, words: "Warm-up day 5" };
    const s = day([
      box("asad", { ramp: up }),
      box("stevie", { ramp: up, sent_today: 0, waiting: 0 }),
    ]);
    assert(mailboxDay(s.senders[0], s, MON_0915).next.includes("up to 10 more")); // sent on day 5, so tomorrow is day 6
    assert(mailboxDay(s.senders[1], s, MON_0915).next.includes("up to 5 more")); // sent nothing: still day 5 tomorrow
  },
);

Deno.test(
  "mailbox: an engine that does not report sent and waiting gets the old plain count, never an invented one",
  () => {
    const s = day([box("asad", { sent_today: undefined, waiting: undefined, used: 4 })]);
    const d = mailboxDay(s.senders[0], s, MON_0915);
    assertEquals([d.pill, d.today], ["On autopilot", "Today, Mon Nov 16: 4 of 5 used."]);
  },
);

Deno.test(
  "day line: the top of the page says today is done, or what waits on you, and what comes next",
  () => {
    const done = day([box("asad"), box("stevie"), box("zeus")]);
    assertEquals(dayLine(done, MON_0915), {
      tone: "ok",
      today: "Today, Mon Nov 16: 15 emails sent, none waiting. Everything for today has gone out.",
      next: "Next: Tue Nov 17 at 8:30 AM ET, up to 15 more are written and wait for your approval at the top of this page.",
    });
    const wait = day([
      box("asad", { sent_today: 0, waiting: 5 }),
      box("stevie", { sent_today: 0, waiting: 5 }),
    ]);
    const w = dayLine(wait, MON_0915);
    assertEquals(w.tone, "warn");
    assertEquals(
      w.today,
      "Today, Mon Nov 16: 0 sent, 10 waiting for your approval at the top of this page. Nothing goes out until you press Send.",
    );
    const held = day([box("asad", { state: "held", why: "x" })]);
    assertEquals(
      dayLine(held, MON_0915).today,
      "Today, Mon Nov 16: no mailbox can write emails right now.",
    );
  },
);

// ---- 2026-11-16: approved emails wait for 9:30 AM where the business is; the page calls them approved, never "waiting for you" ----
Deno.test(
  "mailbox: approved emails held for the business's own morning read as approved and going out, with the last time",
  () => {
    const s = day(
      [
        box("asad", {
          sent_today: 1,
          waiting: 0,
          scheduled: 4,
          scheduled_last: "2026-11-16T12:30",
        }),
      ],
      { local_not_before: "09:30" },
    );
    const d = mailboxDay(s.senders[0], s, MON_0915);
    assertEquals([d.pill, d.tone], ["Approved, going out", "ok"]);
    assertEquals(
      d.today,
      "Today, Mon Nov 16: 1 sent, 4 approved and going out at 9:30 AM in each business's own time zone, the last at 12:30 PM ET. Nothing more is needed from you.",
    );
    assertEquals([d.sent, d.scheduled, d.waiting], [1, 4, 0]);
    // some approved and going out, some still needing a person: both are said, and the pill is the one that needs him
    const mix = day(
      [
        box("asad", {
          sent_today: 0,
          waiting: 2,
          scheduled: 3,
          scheduled_last: "2026-11-16T11:30",
        }),
      ],
      { local_not_before: "09:30" },
    );
    const x = mailboxDay(mix.senders[0], mix, MON_0915);
    assertEquals(x.pill, "Waiting for your approval");
    assertEquals(
      x.today,
      "Today, Mon Nov 16: 0 sent, 3 approved and going out at 9:30 AM in each business's own time zone, the last at 11:30 AM ET, 2 waiting for your approval at the top of this page.",
    );
    // held for sending hours only (no local rule): no time of day is invented
    const hrs = day([box("asad", { sent_today: 0, waiting: 0, scheduled: 5 })]);
    assertEquals(
      mailboxDay(hrs.senders[0], hrs, MON_0915).today,
      "Today, Mon Nov 16: 0 sent, 5 approved and going out in the next sending hours. Nothing more is needed from you.",
    );
  },
);

Deno.test(
  "day line and parse: the approved-and-going-out count, its last time and the 9:30 rule come through",
  () => {
    const s = day(
      [
        box("asad", {
          sent_today: 2,
          waiting: 0,
          scheduled: 3,
          scheduled_last: "2026-11-16T11:30",
        }),
        box("zeus", {
          sent_today: 0,
          waiting: 0,
          scheduled: 5,
          scheduled_last: "2026-11-16T12:30",
        }),
      ],
      { local_not_before: "09:30" },
    );
    assertEquals(
      [s.local_not_before, s.senders[0].scheduled, s.senders[1].scheduled_last],
      ["09:30", 3, "2026-11-16T12:30"],
    );
    const d = dayLine(s, MON_0915);
    assertEquals(d.tone, "ok");
    assertEquals(
      d.today,
      "Today, Mon Nov 16: 2 sent, 8 approved and going out at 9:30 AM in each business's own time zone, the last at 12:30 PM ET. Nothing more is needed from you.",
    );
    assertEquals(
      [hourWords("09:30"), hourWords("13:05"), hourWords("soon")],
      ["9:30 AM", "1:05 PM", ""],
    );
    // a rule that is not a time of day is dropped, and an older engine leaves the count unknown
    const bad = day([box("asad", { scheduled: undefined })], { local_not_before: "morning" });
    assertEquals(
      [bad.local_not_before, bad.senders[0].scheduled, bad.senders[0].scheduled_last],
      ["", null, ""],
    );
  },
);

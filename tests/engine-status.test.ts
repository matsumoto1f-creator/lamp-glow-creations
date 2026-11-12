// deno test --node-modules-dir=none tests/engine-status.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { freshness, jobState, MAX_BYTES, parseStatus, type Job } from "../src/lib/engine-status.ts";

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

// deno test --node-modules-dir=none tests/callback-scheduler.test.ts
//
// 2026-11-24, Asad: "i also want there to be a scheduler for the call back disposition option in
// the portal when i open the lead ... so i know what to do throughout my day". A lead set to
// Callback takes a day and time; the calendar's "Call back ..." item sits at that time.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  callbackAt,
  callbackParts,
  isDayOnly,
  nyDay,
  planCalendar,
  RULES,
  sayCallback,
  type CalInput,
} from "../src/lib/calendar.ts";
import { callbackChoice } from "../src/lib/callback-choice.ts";
import picker from "../src/components/staff/callback-picker.tsx" with { type: "text" };
import leads from "../src/components/staff/engine-leads.tsx" with { type: "text" };
import server from "../src/lib/calendar.server.ts" with { type: "text" };
import sql from "../supabase/migrations/20261124120000_engine_lead_callback_at.sql" with { type: "text" };

const NOW = new Date("2026-11-24T15:00:00Z");
const input = (engineLeads: CalInput["engineLeads"]): CalInput => ({
  seats: [{ slug: "asad", user_id: "u-asad", active: true }],
  admins: [],
  files: [],
  calls: [],
  leads: [],
  engineLeads,
  invites: [],
  offers: [],
  submissions: [],
  docRequests: [],
  outbox: [],
  loaded: [...RULES],
});
const lead = {
  id: 7,
  source: "fl_ucc",
  name: "Ace Example Services",
  status: "callback",
  rep_slug: "asad",
  worked_at: "2026-11-24T14:00:00Z",
  pushed_at: null,
  signals: [],
};

Deno.test("callback time: a day and time become the New York moment, winter and summer", () => {
  assertEquals(callbackAt("2026-11-25", "14:30"), "2026-11-25T19:30:00.000Z");
  assertEquals(callbackAt("2026-07-01", "09:00"), "2026-07-01T13:00:00.000Z");
});

Deno.test("callback time: a day with no time is midnight New York, shown as all day", () => {
  const at = callbackAt("2026-11-25", "")!;
  assertEquals(at, "2026-11-25T05:00:00.000Z");
  assert(isDayOnly(at));
  assert(!isDayOnly(callbackAt("2026-11-25", "14:30")!));
  assertEquals(sayCallback(at), "Wed, Nov 25");
  assertEquals(sayCallback(callbackAt("2026-11-25", "14:30")!), "Wed, Nov 25 at 2:30 PM");
});

Deno.test("callback time: a half-typed or impossible value is nothing", () => {
  for (const [d, t] of [
    ["", "14:30"],
    ["2026-11-31", "10:00"],
    ["2026-13-01", ""],
    ["2026-11-25", "25:00"],
    ["2026-11-25", "9:5"],
    ["11/25/2026", "10:00"],
  ])
    assertEquals(callbackAt(d!, t!), null, `${d} ${t}`);
});

Deno.test("callback time: the boxes show back what was saved", () => {
  assertEquals(callbackParts("2026-11-25T19:30:00.000Z"), { day: "2026-11-25", time: "14:30" });
  assertEquals(callbackParts("2026-11-25T05:00:00.000Z"), { day: "2026-11-25", time: "" });
  assertEquals(callbackParts(null), { day: "", time: "" });
});

Deno.test("picker: what Save would write, and why it is off", () => {
  const today = "2026-11-24";
  assertEquals(callbackChoice("", "", null, today), { at: null, problem: "" });
  assertEquals(callbackChoice("", "14:30", null, today).problem, "Pick the day too.");
  assertEquals(
    callbackChoice("2026-11-23", "", null, today).problem,
    "That day has passed. Pick today or later.",
  );
  assertEquals(callbackChoice("2026-11-25", "14:30", null, today), {
    at: "2026-11-25T19:30:00.000Z",
    problem: "",
  });
  // today is allowed; nothing changed saves nothing
  assert(callbackChoice(today, "", null, today).at);
  assertEquals(callbackChoice("2026-11-25", "14:30", "2026-11-25T19:30:00Z", today), {
    at: null,
    problem: "",
  });
});

Deno.test(
  "calendar: a picked time puts the item at that time, not on the next business day",
  () => {
    const [d] = planCalendar(input([{ ...lead, callback_at: "2026-12-02T19:30:00.000Z" }]), NOW);
    assertEquals(d?.rule, "lead_callback");
    assertEquals(d?.due_at, "2026-12-02T19:30:00.000Z");
    assertEquals(d?.all_day, false);
    assert(d?.why.includes("Wed, Dec 2 at 2:30 PM"));
    assertEquals(d?.owner, "u-asad");
  },
);

Deno.test("calendar: a picked day with no time is an all-day item on that day", () => {
  const [d] = planCalendar(input([{ ...lead, callback_at: "2026-12-02T05:00:00.000Z" }]), NOW);
  assertEquals(d?.all_day, true);
  assertEquals(nyDay(Date.parse(d!.due_at)), "2026-12-02");
});

Deno.test("calendar: changing the time makes a new item (the old one clears by itself)", () => {
  const key = (at: string) =>
    planCalendar(input([{ ...lead, callback_at: at }]), NOW)[0]!.source_key;
  assert(key("2026-12-02T19:30:00.000Z") !== key("2026-12-03T19:30:00.000Z"));
  // no time picked: the key is what it was before this change, so no existing item is disturbed
  assertEquals(planCalendar(input([lead]), NOW)[0]?.source_key, "callback:7:2026-11-24T14:00:00Z");
  assertEquals(
    planCalendar(input([{ ...lead, callback_at: null }]), NOW)[0]?.source_key,
    "callback:7:2026-11-24T14:00:00Z",
  );
});

Deno.test("calendar: a picked time far ahead still shows, long after the lead was marked", () => {
  const old = {
    ...lead,
    worked_at: "2026-09-01T14:00:00Z",
    callback_at: "2026-12-15T15:00:00.000Z",
  };
  assertEquals(planCalendar(input([old]), NOW).length, 1);
  // a picked time more than 30 days gone makes nothing
  assertEquals(planCalendar(input([{ ...old, callback_at: "2026-10-01T15:00:00.000Z" }]), NOW), []);
});

Deno.test("calendar: a picked time on a lead that left Callback makes no callback item", () => {
  const items = planCalendar(
    input([{ ...lead, status: "called", callback_at: "2026-12-02T19:30:00.000Z" }]),
    NOW,
  );
  assertEquals(items, []);
});

Deno.test("lead page: the picker shows only on a lead set to Callback", () => {
  assert(leads.includes('{row.status === "callback" && <CallbackPicker leadId={row.id} />}'));
});

Deno.test(
  "picker: shows nothing until the column exists, and shows what the database saved",
  () => {
    assert(picker.includes("if (r.error || !r.data) return setSaved(null);"));
    assert(picker.includes("if (!saved) return null;"));
    const save = picker.slice(picker.indexOf("async function save()"), picker.indexOf("const box"));
    assert(save.includes('.select("callback_at" as never)') && save.includes("setSaved({ at:"));
    assert(save.includes("Not saved: this lead isn't yours to change."));
  },
);

Deno.test(
  "server: picked times are read apart, so the calendar works before the column exists",
  () => {
    assert(server.includes("const pickedRows = picked.error ? [] :"));
    // the main read of worked leads does not ask for the new column
    const worked = server.slice(server.indexOf("let workedQ"), server.indexOf("let repliesQ"));
    assert(!worked.includes("callback_at"));
  },
);

Deno.test(
  "database: the time is dropped when a lead leaves Callback, and running twice is safe",
  () => {
    assert(sql.includes("add column if not exists callback_at timestamptz"));
    assert(
      sql.includes("if new.status is distinct from 'callback' then\n    new.callback_at := null;"),
    );
    assert(sql.includes("drop trigger if exists engine_leads_callback_clear"));
    assert(
      sql.includes(
        "revoke all on function public.engine_leads_callback_clear() from public, anon;",
      ),
    );
  },
);

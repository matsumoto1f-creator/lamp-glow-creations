// deno test --node-modules-dir=none tests/private-lists.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  entriesFromCsv,
  groupEntries,
  importStatus,
  mailHref,
  matches,
  MAX_IMPORT,
  nameKey,
  planImport,
  siteHref,
  statusAfter,
  statusCounts,
} from "../src/lib/private-lists.ts";

const CSV = [
  "tier,business,owner_or_decision_maker,phone,area,website,notes,email,emailed_at,emailed_to,emailed_subject",
  '1,Harbor Jewelers,Sam Rivera (owner/president),555-0101,Northside 10001,harborjewelers.example,"gold, estate",harbor@example.com,2026-11-10T12:03:00-05:00,harbor@example.com,"Sam, quick question?"',
  "1,Summit Jewelers,Lee Park,555-0102,Midtown 10002,summit.example,,lee@summit.example,2026-11-10T13:07:00-05:00,,Lee quick question",
  "2,Third Street Jewelry,Pat Jones,555-0103,10003,thirdstreet.example,,,,,",
].join("\n");

Deno.test("import: reads the prospect file's own column names", () => {
  const { entries, problems } = entriesFromCsv(CSV);
  assertEquals(problems, []);
  assertEquals(entries.length, 3);
  const first = entries[0]!;
  assertEquals(first.business, "Harbor Jewelers");
  assertEquals(first.contact, "Sam Rivera (owner/president)");
  assertEquals(first.grp, "1");
  assertEquals(first.notes, "gold, estate");
  assertEquals(first.emailed, {
    at: "2026-11-10T17:03:00.000Z",
    to: "harbor@example.com",
    subject: "Sam, quick question?",
  });
  // no emailed_to cell: the log line falls back to the business's email
  assertEquals(entries[1]!.emailed?.to, "lee@summit.example");
  assertEquals(entries[2]!.emailed, null);
  assertEquals(entries[2]!.email, null);
});

Deno.test("import: a sent email starts the business as Emailed, the rest as Not contacted", () => {
  const { entries } = entriesFromCsv(CSV);
  assertEquals(entries.map(importStatus), ["emailed", "emailed", "new"]);
  const withStatus = entriesFromCsv("business,status\nA,talking\nB,\n").entries;
  assertEquals(withStatus.map(importStatus), ["talking", "new"]);
});

Deno.test("import: bad rows are named and left out, good rows still come through", () => {
  const { entries, problems } = entriesFromCsv(
    [
      "business,status,emailed_at",
      "Good Store,,",
      ",,",
      " ,called,",
      "good  store,,",
      "Odd Status,maybe,",
      "Bad Date,,yesterday",
    ].join("\n"),
  );
  assertEquals(
    entries.map((e) => e.business),
    ["Good Store"],
  );
  assertEquals(problems.length, 4);
  assert(problems[0]!.includes("no business name"));
  assert(problems[1]!.includes("in the file twice"));
  assert(problems[2]!.includes('status "maybe"'));
  assert(problems[3]!.includes("isn't a date and time"));
});

Deno.test("import: needs a business column, a non-empty file and at most MAX_IMPORT rows", () => {
  assertEquals(entriesFromCsv("").problems, ["The file is empty."]);
  assertEquals(entriesFromCsv("phone,email\n1,2\n").entries, []);
  assert(entriesFromCsv("phone,email\n1,2\n").problems[0]!.includes('"business" column'));
  const big = "business\n" + Array.from({ length: MAX_IMPORT + 1 }, (_, i) => `S${i}`).join("\n");
  assertEquals(entriesFromCsv(big).entries, []);
  assert(entriesFromCsv(big).problems[0]!.includes(`At most ${MAX_IMPORT}`));
  const ok = "business\n" + Array.from({ length: MAX_IMPORT }, (_, i) => `S${i}`).join("\n");
  assertEquals(entriesFromCsv(ok).entries.length, MAX_IMPORT);
});

Deno.test("import plan: a business already on the list is updated, never doubled", () => {
  const { entries } = entriesFromCsv(CSV);
  const existing = [{ id: "e-harbor", business: "  harbor   jewelers " }];
  const plan = planImport(entries, existing, []);
  assertEquals(
    plan.add.map((e) => e.business),
    ["Summit Jewelers", "Third Street Jewelry"],
  );
  assertEquals(plan.update.length, 1);
  assertEquals(plan.update[0]!.id, "e-harbor");
  // only cells the file fills in; status is the owner's own record and is never touched
  assertEquals(plan.update[0]!.fields, {
    contact: "Sam Rivera (owner/president)",
    phone: "555-0101",
    email: "harbor@example.com",
    website: "harborjewelers.example",
    area: "Northside 10001",
    grp: "1",
    notes: "gold, estate",
  });
  assert(!("status" in plan.update[0]!.fields));
  assertEquals(plan.log.length, 2);
});

Deno.test("import plan: a row that says nothing new is left alone", () => {
  const { entries } = entriesFromCsv(CSV);
  const saved = {
    id: "e-third",
    business: "Third Street Jewelry",
    contact: "Pat Jones",
    phone: "555-0103",
    area: "10003",
    website: "thirdstreet.example",
    grp: "2",
    notes: "my own note",
  };
  const plan = planImport([entries[2]!], [saved], []);
  assertEquals(plan.update, []);
  // one cell differs: only that cell is sent
  const moved = planImport([entries[2]!], [{ ...saved, phone: "704-000-0000" }], []);
  assertEquals(moved.update, [
    { id: "e-third", business: "Third Street Jewelry", fields: { phone: "555-0103" } },
  ]);
});

Deno.test("import plan: an empty cell never wipes what is saved", () => {
  const { entries } = entriesFromCsv("business,phone,notes\nThird Street Jewelry,,\n");
  const plan = planImport(entries, [{ id: "e1", business: "Third Street Jewelry" }], []);
  assertEquals(plan.add, []);
  assertEquals(plan.update, []);
  assertEquals(plan.log, []);
});

Deno.test("import plan: importing the same file twice logs each email once", () => {
  const { entries } = entriesFromCsv(CSV);
  const existing = [
    { id: "e-harbor", business: "Harbor Jewelers" },
    { id: "e-summit", business: "Summit Jewelers" },
    { id: "e-third", business: "Third Street Jewelry" },
  ];
  const already = [
    // same minute, stored by the database with seconds and an offset
    { entry_id: "e-harbor", kind: "email" as const, happened_at: "2026-11-10T17:03:00+00:00" },
    // a call at the same minute is not that email
    { entry_id: "e-summit", kind: "call" as const, happened_at: "2026-11-10T18:07:00+00:00" },
  ];
  const plan = planImport(entries, existing, already);
  assertEquals(plan.add, []);
  assertEquals(
    plan.log.map((l) => l.business),
    ["Summit Jewelers"],
  );
  const both = planImport(entries, existing, [
    ...already,
    { entry_id: "e-summit", kind: "email" as const, happened_at: "2026-11-10T18:07:30.000Z" },
  ]);
  assertEquals(both.log, []);
});

Deno.test("status after logging: moves forward only, and a note moves nothing", () => {
  assertEquals(statusAfter("new", "email"), "emailed");
  assertEquals(statusAfter("new", "call"), "called");
  assertEquals(statusAfter("emailed", "call"), "called");
  assertEquals(statusAfter("called", "email"), "called");
  assertEquals(statusAfter("emailed", "reply"), "replied");
  assertEquals(statusAfter("talking", "email"), "talking");
  assertEquals(statusAfter("talking", "reply"), "talking");
  assertEquals(statusAfter("won", "call"), "won");
  assertEquals(statusAfter("dead", "reply"), "dead");
  assertEquals(statusAfter("new", "note"), "new");
});

Deno.test("links: only real web and email addresses become links", () => {
  assertEquals(siteHref("summit.example"), "https://summit.example/");
  assertEquals(siteHref(" https://shop.example/pages/staff "), "https://shop.example/pages/staff");
  assertEquals(siteHref(""), null);
  assertEquals(siteHref(null), null);
  assertEquals(siteHref("none"), null);
  assertEquals(siteHref("javascript:alert(1)"), null);
  assertEquals(mailHref("lee@summit.example"), "mailto:lee@summit.example");
  assertEquals(mailHref("lee@summit"), null);
  assertEquals(mailHref("a@b.com?bcc=x@y.com, z"), null);
  assertEquals(mailHref(null), null);
});

Deno.test("groups: in the order they first appear, ungrouped last", () => {
  const g = groupEntries([
    { grp: "Tier 2", n: 1 },
    { grp: null, n: 2 },
    { grp: "Tier 1", n: 3 },
    { grp: " Tier 2 ", n: 4 },
  ]);
  assertEquals(
    g.map((x) => [x.name, x.entries.map((e) => e.n)]),
    [
      ["Tier 2", [1, 4]],
      ["Tier 1", [3]],
      ["Other", [2]],
    ],
  );
  // nothing grouped: one unnamed block, so no heading is drawn
  assertEquals(groupEntries([{ grp: null }, { grp: "" }])[0]!.name, "");
  assertEquals(groupEntries([]), []);
});

Deno.test("search and counts", () => {
  const e = {
    business: "Summit Jewelers",
    contact: "Lee Park",
    area: "Midtown 10002",
    email: "lee@summit.example",
    phone: "555-0102",
  };
  assert(matches(e, ""));
  assert(matches(e, "  summit "));
  assert(matches(e, "lee"));
  assert(matches(e, "10002"));
  assert(matches(e, "0102"));
  assert(!matches(e, "harbor"));
  assert(matches({ ...e, contact: null, area: null, email: null, phone: null }, "summ"));
  assertEquals(nameKey("  Harbor   JEWELERS "), "harbor jewelers");
  const c = statusCounts([{ status: "new" }, { status: "emailed" }, { status: "emailed" }]);
  assertEquals([c.new, c.emailed, c.replied, c.dead], [1, 2, 0, 0]);
});

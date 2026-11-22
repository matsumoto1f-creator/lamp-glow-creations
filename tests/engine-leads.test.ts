// deno test --node-modules-dir=none tests/engine-leads.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  BOARD_MAX_CSV,
  boardBatch,
  leadsFromCsv,
  leadCardText,
  leadsToCsv,
  type LeadExport,
  leadRecords,
  leadType,
  searchFilter,
  ownerLabel,
  ownerScope,
  savedOwner,
  splitWhy,
  tookMca,
} from "../src/lib/engine-leads.ts";

const sig = (...types: string[]) =>
  types.map((t) => ({ source: "x", signal_type: t, signal_date: "2026-11-03" }));

Deno.test("lead type: fleet first, then contractor, auto shop, UCC", () => {
  assertEquals(leadType(sig("fmcsa_established")), "fleet");
  assertEquals(leadType(sig("nj_hic", "fmcsa_established")), "fleet");
  assertEquals(leadType(sig("nyc_license")), "contractor");
  assertEquals(leadType(sig("nyc_permit", "mca_ucc")), "contractor");
  assertEquals(leadType(sig("nj_auto_facility")), "auto");
  assertEquals(leadType(sig("mca_ucc")), "ucc");
});

Deno.test("lead type: no or odd signals have no type", () => {
  assertEquals(leadType(null), null);
  assertEquals(leadType("fmcsa_established"), null);
  assertEquals(leadType([null, 3, {}]), null);
  assertEquals(leadType(sig("ny_new_corp")), null);
});

Deno.test("took an MCA: only a UCC filing by an MCA funder counts", () => {
  assert(tookMca(sig("fmcsa_established", "mca_ucc")));
  assert(!tookMca(sig("fmcsa_established")));
  assert(!tookMca(undefined));
});

Deno.test("why: owner, where the name came from, and each point explained", () => {
  const w = splitWhy(
    "Owner: Genci Sela (licensed contractor on an NYC permit); also Ana Sela · operating in 2020-21 (PPP loan) · PPP payroll $138,000/mo · contractor · has phone",
  );
  assertEquals(w.owner, "Genci Sela");
  assertEquals(w.ownerFrom, "licensed contractor on an NYC permit");
  assertEquals(w.alsoOwner, "Ana Sela");
  assertEquals(
    w.points.map((p) => p.text),
    ["operating in 2020-21 (PPP)", "PPP payroll $138,000/mo"],
  );
  assert(w.points[1].means!.includes("$138,000 a month"));
  assert(!w.points.some((p) => /loan/i.test(p.text + (p.means ?? ""))));
});

Deno.test("why: no owner, or nothing at all", () => {
  const w = splitWhy("FMCSA registered 2010 · 19 trucks · has phone");
  assertEquals(w.owner, null);
  assertEquals(
    w.points.map((p) => p.means),
    ["A registered trucking company since 2010.", "19 trucks on its federal registration."],
  );
  assertEquals(splitWhy(null), { owner: null, ownerFrom: null, alsoOwner: null, points: [] });
});

Deno.test("records: plain names, details kept, repeats dropped, newest first", () => {
  const r = leadRecords([
    { source: "nyc_permit", signal_type: "nyc_permit", signal_date: "2026-10-05" },
    { source: "nyc_permit", signal_type: "nyc_permit", signal_date: "2026-10-05" },
    {
      source: "nyc_permit",
      signal_type: "nyc_permit",
      signal_date: "2026-10-27",
      detail: "1 permitted job(s) since 2026-10-22, $56,000 estimated; Plumbing",
    },
    { source: "nj_auto", signal_type: "nj_auto_facility", signal_date: "" },
    null,
  ]);
  assertEquals(r, [
    {
      label: "NYC building permit",
      date: "2026-10-27",
      detail: "1 permitted job(s) since 2026-10-22, $56,000 estimated; Plumbing",
    },
    { label: "NYC building permit", date: "2026-10-05", detail: null },
    { label: "NJ auto facility license", date: null, detail: null },
  ]);
  assertEquals(leadRecords("x"), []);
});

Deno.test("search: empty box searches nothing", () => {
  assertEquals(searchFilter("   "), null);
  assertEquals(searchFilter("(),*%"), null);
});

Deno.test("search: words match name, email, city, industry and phone", () => {
  assertEquals(
    searchFilter("Acme Roofing"),
    'name.ilike."%Acme Roofing%",email.ilike."%Acme Roofing%",city.ilike."%Acme Roofing%",industry.ilike."%Acme Roofing%",phone.ilike."%Acme Roofing%"',
  );
});

Deno.test("search: filter syntax can't be injected", () => {
  const f = searchFilter('x",status.eq.dead,name.ilike."y')!;
  assert(!f.includes('"x"'));
  assertEquals(f.split(",").length, 5);
  assert(!/[(),]/.test(f.replace(/",/g, "")));
});

Deno.test("search: a number finds phones however they're written", () => {
  const f = searchFilter("718-555")!;
  assert(f.endsWith('phone.ilike."%7%1%8%5%5%5%"'));
  assert(searchFilter("12")!.endsWith('phone.ilike."%12%"'));
});

const row = (o: Partial<LeadExport>): LeadExport => ({
  name: null,
  phone: null,
  email: null,
  city: null,
  state: null,
  industry: null,
  tier: null,
  need: null,
  reason: null,
  signals: [],
  first_found: null,
  status: "new",
  notes: "",
  rep_slug: null,
  worked_at: null,
  ...o,
});

Deno.test("csv: header, quoting, labels and rep names", () => {
  const csv = leadsToCsv(
    [
      row({
        name: 'Joe\'s "Best" Deli, LLC',
        phone: "(718) 555-1212",
        status: "no_answer",
        rep_slug: "zeus",
        notes: "line one\nline two",
        signals: [{ source: "nyc_permit", signal_date: "2026-10-01" }],
        worked_at: "2026-10-28T14:00:00Z",
      }),
    ],
    (s) => (s === "zeus" ? "Zeus" : ""),
  );
  assert(csv.startsWith("﻿Business,Phone,Email"));
  const [, line] = csv.slice(1).split("\r\n");
  assert(line.startsWith('"Joe\'s ""Best"" Deli, LLC",(718) 555-1212,'));
  assert(line.includes(",No answer,"));
  assert(line.includes('"line one\nline two",Zeus,2026-10-28'));
  assert(line.includes("nyc_permit 2026-10-01"));
});

Deno.test("csv: a cell that looks like a formula opens as text", () => {
  const csv = leadsToCsv(
    [row({ name: '=HYPERLINK("http://x")', phone: "+1 718 555 1212", notes: "@sum" })],
    () => "",
  );
  const line = csv.slice(1).split("\r\n")[1];
  assert(line.startsWith(`"'=HYPERLINK(""http://x"")",'+1 718 555 1212,`));
  assert(line.includes(",'@sum,"));
});

const BOARD_CSV =
  "source,source_key,name,phone,rep_slug\r\nwar-room-engine,k1,Acme,(718) 555-1212,zeus\r\n";

Deno.test("board: a well-formed batch is taken and reads like the downloaded file", () => {
  const b = boardBatch({
    type: "lamp-board:leads",
    batch: 7,
    label: " 1 lead for Zeus ",
    csv: BOARD_CSV,
  });
  assertEquals(b, { batch: 7, label: "1 lead for Zeus", csv: BOARD_CSV });
  const { leads, problems } = leadsFromCsv(b!.csv, ["zeus"], null);
  assertEquals(problems, []);
  assertEquals(leads[0].rep_slug, "zeus");
});

Deno.test("board: anything else is ignored", () => {
  assertEquals(boardBatch(null), null);
  assertEquals(boardBatch("lamp-board:leads"), null);
  assertEquals(boardBatch({ type: "other", batch: 1, csv: BOARD_CSV }), null);
  assertEquals(boardBatch({ type: "lamp-board:leads", batch: 0, csv: BOARD_CSV }), null);
  assertEquals(boardBatch({ type: "lamp-board:leads", batch: 1.5, csv: BOARD_CSV }), null);
  assertEquals(boardBatch({ type: "lamp-board:leads", batch: 1, csv: "" }), null);
  assertEquals(
    boardBatch({ type: "lamp-board:leads", batch: 1, csv: "x".repeat(BOARD_MAX_CSV + 1) }),
    null,
  );
  assertEquals(
    boardBatch({ type: "lamp-board:leads", batch: 3, csv: BOARD_CSV })?.label,
    "Board batch #3",
  );
});

Deno.test("lead card on a phone: the line under the name, who to ask for, the reasons", () => {
  const base = { industry: null, city: null, state: null, reason: null, contact_name: null };
  // nothing known: a dash under the name, no one to ask for, no reasons
  assertEquals(leadCardText(base), { sub: "—", ask: null, why: "" });
  // industry and place on one line; the owner on record is who to ask for
  assertEquals(
    leadCardText({
      ...base,
      industry: "Auto repair",
      city: "Paterson",
      state: "NJ",
      reason: "Owner: Maria Ortega (FMCSA) · 14 trucks · has phone",
    }),
    { sub: "Auto repair · Paterson, NJ", ask: "Maria Ortega", why: "14 trucks" },
  );
  // the name the rep got on the call beats the owner on record; a blank one doesn't
  const owner = { ...base, reason: "Owner: Maria Ortega · license since 2019" };
  assertEquals(leadCardText({ ...owner, contact_name: "Dmitri" }).ask, "Dmitri");
  assertEquals(leadCardText({ ...owner, contact_name: "  " }).ask, "Maria Ortega");
  // a state alone still shows where it is
  assertEquals(leadCardText({ ...base, state: "NY" }).sub, "NY");
});

Deno.test("whose leads: everyone, mine, nobody's, or one rep's", () => {
  const reps = [
    { slug: "asad", name: "Asad Matsumoto" },
    { slug: "zeus", name: "Zeus" },
  ];
  assertEquals(ownerScope("", "asad"), { kind: "all" });
  assertEquals(ownerScope("me", "asad"), { kind: "rep", slug: "asad" });
  // an admin without a rep seat has no "mine": show everyone rather than nothing
  assertEquals(ownerScope("me", null), { kind: "all" });
  assertEquals(ownerScope("none", "asad"), { kind: "none" });
  assertEquals(ownerScope("rep:zeus", "asad"), { kind: "rep", slug: "zeus" });
  // anything odd in the value is ignored, never sent to the database
  assertEquals(ownerScope("rep:Zeus,rep_slug.neq.x", "asad"), { kind: "all" });
  assertEquals(ownerScope("rep:", "asad"), { kind: "all" });

  assertEquals(ownerLabel("", "asad", reps), "Every engine lead");
  assertEquals(ownerLabel("me", "asad", reps), "Your leads");
  assertEquals(ownerLabel("none", "asad", reps), "Not given to anyone");
  assertEquals(ownerLabel("rep:zeus", "asad", reps), "Zeus's leads");
  assertEquals(ownerLabel("rep:gone", "asad", reps), "One rep's leads");
});

Deno.test("whose leads: a remembered choice is kept only while it still makes sense", () => {
  const reps = [{ slug: "zeus", name: "Zeus" }];
  assertEquals(savedOwner(null, "asad", reps), "");
  assertEquals(savedOwner("me", "asad", reps), "me");
  assertEquals(savedOwner("me", null, reps), "");
  assertEquals(savedOwner("none", "asad", reps), "none");
  assertEquals(savedOwner("rep:zeus", "asad", reps), "rep:zeus");
  // a rep who has left the team: back to everyone
  assertEquals(savedOwner("rep:gone", "asad", reps), "");
  // their own seat picked by name reads as "mine"
  assertEquals(savedOwner("rep:asad", "asad", reps), "me");
  assertEquals(savedOwner("garbage", "asad", reps), "");
});

// deno test --node-modules-dir=none tests/smart-lead.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  PLAYBOOKS,
  playbookFor,
  seasonNote,
  seasonOf,
  smartLead,
  timingFrom,
  warmWinter,
} from "../src/lib/smart-lead.ts";

const day = (iso: string) => new Date(`${iso}T12:00:00`);

Deno.test("playbook: the engine's industry text picks the trade", () => {
  assertEquals(playbookFor("home improvement contractor", null).key, "contractor");
  assertEquals(playbookFor("Home Improvement Contractor", null).key, "contractor");
  assertEquals(playbookFor("Construction Labor Provider", null).key, "contractor");
  assertEquals(playbookFor("trucking", null).key, "trucking");
  assertEquals(playbookFor("auto repair", null).key, "auto_repair");
  assertEquals(playbookFor("Secondhand Dealer - Auto", null).key, "used_cars");
  assertEquals(playbookFor("Tow Truck Company", null).key, "towing");
  assertEquals(playbookFor("restaurant", null).key, "restaurant");
  assertEquals(playbookFor("Hotel", null).key, "hotel");
  assertEquals(playbookFor("Electronics Store", null).key, "retail");
  assertEquals(playbookFor("Fine Jewelry", null).key, "jewelry");
  assertEquals(playbookFor("Car Wash", null).key, "car_wash");
  assertEquals(playbookFor("Scrap Metal Processor", null).key, "scrap");
  assertEquals(playbookFor("Self-Storage Facility", null).key, "storage");
  assertEquals(playbookFor("Industrial Laundry", null).key, "service");
  assertEquals(playbookFor("landscaping", null).key, "landscaping");
});

Deno.test("playbook: a parking garage isn't a repair shop", () => {
  assertEquals(playbookFor("Garage & Parking Lot", "auto").key, "general");
});

Deno.test("playbook: no industry falls back to the lead type, then general", () => {
  assertEquals(playbookFor("", "fleet").key, "trucking");
  assertEquals(playbookFor(null, "contractor").key, "contractor");
  assertEquals(playbookFor(null, "auto").key, "auto_repair");
  assertEquals(playbookFor(null, "ucc").key, "general");
  assertEquals(playbookFor(null, null).key, "general");
});

Deno.test("seasons follow the month", () => {
  assertEquals(seasonOf(day("2026-12-05")), "winter");
  assertEquals(seasonOf(day("2026-02-28")), "winter");
  assertEquals(seasonOf(day("2026-03-01")), "spring");
  assertEquals(seasonOf(day("2026-07-04")), "summer");
  assertEquals(seasonOf(day("2026-11-09")), "fall");
});

Deno.test("winter reads differently where it doesn't freeze", () => {
  const book = playbookFor("contractor", null);
  assert(warmWinter("fl") && !warmWinter("NJ") && !warmWinter(null));
  const north = seasonNote(book, day("2027-01-10"), "NJ");
  const south = seasonNote(book, day("2027-01-10"), "FL");
  assertStringIncludes(north.now, "cold");
  assert(north.now !== south.now);
  // a playbook without a warm-winter line keeps its winter line everywhere
  const hotel = playbookFor("Hotel", null);
  assertEquals(seasonNote(hotel, day("2027-01-10"), "FL"), hotel.seasons.winter);
});

Deno.test("a jeweler in November hears about the holidays", () => {
  const s = smartLead(
    { industry: "Fine Jewelry", city: "Newark", state: "NJ", owner: "Maria Test", signals: [] },
    null,
    day("2026-11-09"),
  );
  assertEquals(s.month, "November");
  assertStringIncludes(s.now.now, "holidays");
  assertStringIncludes(s.opener, "Hi Maria,");
  assertStringIncludes(s.opener, "jewelers around Newark");
  assertEquals(s.level.n, 1);
});

Deno.test("a merchant with an advance on record starts at level 2", () => {
  const s = smartLead(
    { industry: "", signals: [{ signal_type: "mca_ucc", signal_date: "2026-06-01" }] },
    "ucc",
    day("2026-11-09"),
  );
  assertEquals(s.level.n, 2);
  assertStringIncludes(s.opener, "Hi, this is");
});

Deno.test("timing: the UCC clock, from new to renewal window to old", () => {
  const ucc = (d: string) => [{ signal_type: "mca_ucc", signal_date: d }];
  const today = day("2026-11-09");
  assertStringIncludes(timingFrom(ucc("2026-10-20"), today)[0]!, "advance is new");
  assertStringIncludes(timingFrom(ucc("2026-06-01"), today)[0]!, "half paid down");
  assertStringIncludes(timingFrom(ucc("2025-09-01"), today)[0]!, "paid off or renewed");
});

Deno.test("timing: a fresh permit is a reason to call now, an old one isn't", () => {
  const today = day("2026-11-09");
  const fresh = timingFrom(
    [
      {
        signal_type: "nyc_permit",
        signal_date: "2026-11-01",
        detail: "$56,000 estimated; Plumbing",
      },
    ],
    today,
  );
  assertStringIncludes(fresh[0]!, "8 days ago ($56,000 estimated; Plumbing)");
  assertEquals(timingFrom([{ signal_type: "nyc_permit", signal_date: "2026-06-01" }], today), []);
  assertEquals(timingFrom(null, today), []);
});

Deno.test("no playbook says loan, and every one is complete", () => {
  for (const b of PLAYBOOKS) {
    const all = JSON.stringify(b);
    assert(!/\bloans?\b/i.test(all), `${b.key} says loan`);
    assert(b.uses.length >= 2 && b.language.length >= 3 && b.pushback.length >= 1, b.key);
    for (const s of ["winter", "spring", "summer", "fall"] as const)
      assert(b.seasons[s].now && b.seasons[s].use, `${b.key} ${s}`);
  }
});

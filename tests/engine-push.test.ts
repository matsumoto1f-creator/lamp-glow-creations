// deno test --node-modules-dir=none tests/engine-push.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { MAX_PUSH, parsePush, perRep } from "../src/lib/engine-push.ts";

const lead = (over: Record<string, unknown> = {}) => ({
  source: "war-room-engine",
  source_key: "ACME PAVING|NJ",
  name: "Acme Paving LLC",
  phone: "2015550101",
  city: "Edison",
  state: "nj",
  industry: "contractor",
  tier: "a",
  need: 3,
  reason: "PRIOR MCA",
  signals: [{ source: "ucc", signal_type: "mca_ucc", signal_date: "2026-10-01" }],
  first_found: "2026-10-30",
  rep_slug: "Stevie",
  ...over,
});

Deno.test("push: a good lead goes in, normalised", () => {
  const { leads, problems } = parsePush({ leads: [lead()] }, ["stevie"]);
  assertEquals(problems, []);
  assertEquals(leads[0].rep_slug, "stevie");
  assertEquals(leads[0].tier, "A");
  assertEquals(leads[0].state, "NJ");
  assertEquals(leads[0].need, 3);
  assertEquals(leads[0].email, null);
});

Deno.test("push: only reps who can take leads", () => {
  const { leads, problems } = parsePush({ leads: [lead({ rep_slug: "zeus" })] }, ["stevie"]);
  assertEquals(leads.length, 0);
  assert(problems[0].includes('"zeus" is not a rep'));
});

Deno.test("push: duplicates, missing keys and bad tiers are left out, the rest go in", () => {
  const { leads, problems } = parsePush(
    {
      leads: [
        lead(),
        lead(),
        lead({ source_key: "" }),
        lead({ source_key: "B|NY", tier: "Q" }),
        lead({ source_key: "C|NY" }),
      ],
    },
    ["stevie"],
  );
  assertEquals(
    leads.map((l) => l.source_key),
    ["ACME PAVING|NJ", "C|NY"],
  );
  assertEquals(problems.length, 3);
});

Deno.test("push: wrong shapes are refused, not thrown", () => {
  assertEquals(parsePush(null, ["stevie"]).leads, []);
  assertEquals(parsePush({ leads: "x" }, ["stevie"]).problems, ["Send { leads: [...] }."]);
  const big = Array.from({ length: MAX_PUSH + 1 }, (_, i) => lead({ source_key: String(i) }));
  assertEquals(parsePush({ leads: big }, ["stevie"]).leads, []);
  const odd = parsePush(
    { leads: [lead({ need: "3", signals: "no", first_found: "Oct 30", name: { x: 1 } })] },
    ["stevie"],
  ).leads[0];
  assertEquals([odd.need, odd.signals, odd.first_found, odd.name], [null, [], null, null]);
});

Deno.test("push: counts per rep", () => {
  const { leads } = parsePush(
    { leads: [lead(), lead({ source_key: "2" }), lead({ source_key: "3", rep_slug: "asad" })] },
    ["stevie", "asad"],
  );
  assertEquals(perRep(leads), { stevie: 2, asad: 1 });
});

// deno test --node-modules-dir=none tests/engine-push.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  emailSourceLine,
  MAX_PUSH,
  parseEmails,
  parsePush,
  perRep,
} from "../src/lib/engine-push.ts";
import server from "../src/lib/engine-push.server.ts" with { type: "text" };
import leadsPage from "../src/components/staff/engine-leads.tsx" with { type: "text" };
import emailSql from "../supabase/migrations/20261120190000_engine_lead_email_source.sql" with { type: "text" };

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

// ---------- the engine's address for a lead's owner (2026-11-20) ----------
const owner = (over: Record<string, unknown> = {}) => ({
  source: "war-room-engine",
  source_key: "ACME PAVING|NJ",
  email: "Dana@AcmePaving.example",
  confidence: "verified",
  method:
    "built from Dana Vella's name and acmepaving.example; the mail server confirms this mailbox exists",
  ...over,
});

Deno.test("owner emails: a good one goes in, lower-cased, with how sure and where from", () => {
  const { emails, problems } = parseEmails({ emails: [owner()] });
  assertEquals(problems, []);
  assertEquals(emails, [
    {
      source: "war-room-engine",
      source_key: "ACME PAVING|NJ",
      email: "dana@acmepaving.example",
      email_confidence: "verified",
      email_method:
        "built from Dana Vella's name and acmepaving.example; the mail server confirms this mailbox exists",
    },
  ]);
});

Deno.test("owner emails: a guess, a bad address, no reason or a repeat is left out", () => {
  const { emails, problems } = parseEmails({
    emails: [
      owner(),
      owner({ source_key: "B", confidence: "guess" }),
      owner({ source_key: "C", confidence: "generic_only" }),
      owner({ source_key: "D", email: "not an address" }),
      owner({ source_key: "E", email: "a@b.example, c@d.example" }),
      owner({ source_key: "F", method: "  " }),
      owner(),
      owner({ source_key: "" }),
      owner({ source_key: "G", confidence: "probable" }),
    ],
  });
  assertEquals(
    emails.map((e) => e.source_key),
    ["ACME PAVING|NJ", "G"],
  );
  assertEquals(problems.length, 7);
  assert(problems.some((p) => p.includes("confirmed, verified or probable")));
  assert(problems.some((p) => p.includes("not a usable address")));
  assert(problems.some((p) => p.includes("where the address came from")));
  assert(problems.some((p) => p.includes("appears twice")));
});

Deno.test("owner emails: wrong shapes are refused, not thrown", () => {
  assertEquals(parseEmails(null).emails, []);
  assertEquals(parseEmails({ emails: "x" }).problems.length, 1);
  const many = Array.from({ length: MAX_PUSH + 1 }, (_, i) => owner({ source_key: `k${i}` }));
  assertEquals(parseEmails({ emails: many }).emails, []);
});

Deno.test(
  "the line under the email box tells the rep to confirm, by how sure the engine is",
  () => {
    const c = emailSourceLine(
      "confirmed",
      "printed on acme.example, and the mailbox carries Dana Vella's name",
    );
    assertEquals(c, {
      tag: "Owner's address",
      text: "Printed on acme.example, and the mailbox carries Dana Vella's name. Still worth confirming on the call.",
    });
    assertEquals(emailSourceLine("verified", "built from the name.")?.tag, "Mailbox checked");
    assert(
      emailSourceLine("verified", "built from the name.")!.text.startsWith(
        "Built from the name. Confirm",
      ),
    );
    const p = emailSourceLine(
      "probable",
      "printed on acme.example: the company's own main mailbox",
    );
    assertEquals(p?.tag, "Likely, not confirmed");
    assert(p!.text.endsWith("Ask on the call for the owner's own."));
    // nothing said by the engine, or a level it does not have: no line
    assertEquals(emailSourceLine(null, "x"), null);
    assertEquals(emailSourceLine("guess", "built, not checked"), null);
    assertEquals(emailSourceLine("confirmed", ""), null);
  },
);

Deno.test(
  "server: owner emails only update leads already there, and touch nothing a rep typed",
  () => {
    // the emails call branches off before any lead is added, reassigned or anyone is notified
    assert(
      server.includes(
        "if ((body as { emails?: unknown } | null)?.emails !== undefined) return pushEmails(db, body);",
      ),
    );
    const fn = server.slice(
      server.indexOf("async function pushEmails"),
      server.indexOf("/** GET /api/engine/push"),
    );
    assert(fn.includes(".update({") && !fn.includes("upsert") && !fn.includes("insert"));
    assert(!fn.includes("contact_") && !fn.includes("rep_slug") && !fn.includes("notifications"));
    assert(
      fn.includes('.eq("source", e.source)') && fn.includes('.eq("source_key", e.source_key)'),
    );
    assert(fn.includes("not_found += 1"));
    assert(fn.includes("The email source columns are not in the database yet."));
  },
);

Deno.test(
  "the lead page shows the source line and still loads on a database without the columns",
  () => {
    assert(leadsPage.includes("const COLUMNS = `${BASE_COLUMNS},email_confidence,email_method`;"));
    assert(leadsPage.includes("({ data, error: err } = await load(BASE_COLUMNS));"));
    assert(leadsPage.includes("emailSourceLine(row.email_confidence, row.email_method)"));
    assert(leadsPage.includes("data-email-source-use"));
    assert(emailSql.includes("add column if not exists email_confidence text"));
    assert(emailSql.includes("('confirmed', 'verified', 'probable')"));
    assert(
      !/\bdrop\b|\bdelete\b|\bupdate public/i.test(emailSql.replace(/--.*$/gm, "")),
      "the file only adds",
    );
  },
);

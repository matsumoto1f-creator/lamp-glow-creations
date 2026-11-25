// deno test --node-modules-dir=none tests/find.test.ts
//
// 2026-11-25, Asad: "no matter what i search related to the lead like a phone number or email or
// business name in the search nothing pops up" and "on every page a lead opens up to i should be
// able to click it and it opens to all the info we have on it".
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  cleanTerm,
  detailOf,
  FIND_COLUMNS,
  looksLikePhone,
  orFilter,
  phoneDigits,
  recordSearch,
  titleOf,
} from "../src/lib/find.ts";
import box from "../src/components/staff/find-anything.tsx" with { type: "text" };
import staff from "../src/routes/staff.tsx" with { type: "text" };
import sent from "../src/components/staff/sent-applications.tsx" with { type: "text" };
import replies from "../src/components/staff/email-replies.tsx" with { type: "text" };
import engine from "../src/components/staff/engine-leads.tsx" with { type: "text" };

Deno.test("find: a phone number matches however it was saved", () => {
  const f = orFilter("7189232893", ["name"], ["phone"])!;
  assertEquals(f, 'phone.ilike."%7%1%8%9%2%3%2%8%9%3%"');
  // the same pattern finds "(718) 923-2893", "718-923-2893" and "7189232893"
  const re = new RegExp("^" + "%7%1%8%9%2%3%2%8%9%3%".replaceAll("%", ".*") + "$");
  for (const saved of ["(718) 923-2893", "718-923-2893", "7189232893", "+1 718.923.2893"])
    assert(re.test(saved), saved);
});

Deno.test("find: a typed phone is read the same with dashes, brackets or a leading 1", () => {
  for (const t of ["(718) 923-2893", "718-923-2893", "+1 718 923 2893", "17189232893"]) {
    assert(looksLikePhone(t), t);
    assertEquals(phoneDigits(t), "7189232893", t);
  }
  assert(!looksLikePhone("Gaudioso"));
  assert(!looksLikePhone("12"));
});

Deno.test("find: a phone search looks in every phone column of the record", () => {
  const c = FIND_COLUMNS.engine;
  const f = orFilter("718 923 2893", c.text, c.phone)!;
  assert(f.includes("phone.ilike") && f.includes("contact_phone.ilike"));
  assert(!f.includes("name.ilike"));
});

Deno.test("find: a name or email looks in the name, email and phone columns", () => {
  const c = FIND_COLUMNS.link;
  const f = orFilter("gaudioso", c.text, c.phone)!;
  for (const col of ["business_name", "first_name", "last_name", "email", "phone"])
    assert(f.includes(`${col}.ilike."%gaudioso%"`), col);
  assert(orFilter("gaudiosocontracting@gmail.com", c.text, c.phone)!.includes("@gmail.com"));
});

Deno.test(
  "find: nothing that could break the filter gets through, and one letter searches nothing",
  () => {
    assertEquals(cleanTerm('a,b)"c(d*e'), "a b c d e");
    assertEquals(orFilter("a", ["name"], ["phone"]), null);
    assertEquals(orFilter("  ", ["name"], ["phone"]), null);
    assert(!orFilter('x"),id.eq.1', ["name"], ["phone"])!.includes('"),'));
  },
);

Deno.test("find: a record opens the fullest page there is for it", () => {
  assertEquals(recordSearch({ file: "f1", elead: 7, lead: "l1", invite: "i1" }), { file: "f1" });
  assertEquals(recordSearch({ file: null, elead: 7, invite: "i1" }), { view: "engine", elead: 7 });
  assertEquals(recordSearch({ elead: 0 }), { view: "engine", elead: 0 });
  assertEquals(recordSearch({ lead: "l1", invite: "i1" }), { lead: "l1" });
  assertEquals(recordSearch({ invite: "i1" }), { view: "sent", invite: "i1" });
  assertEquals(recordSearch({}), null);
});

Deno.test("find: a result's name and contact line", () => {
  assertEquals(titleOf(null, " ", "Gaudioso Contracting Inc"), "Gaudioso Contracting Inc");
  assertEquals(titleOf(null, ""), "No name");
  assertEquals(detailOf("7189232893", "a@b.co"), "7189232893 · a@b.co");
  assertEquals(detailOf(null, ""), "");
});

Deno.test("find box: on every staff page, searching all four kinds of record", () => {
  assert(staff.includes("<FindAnything />"));
  for (const t of [
    'from("applications")',
    'from("engine_leads")',
    'from("application_invites")',
    'from("leads")',
  ])
    assert(box.includes(t), t);
  // searched as the signed-in person: no server route, so row rules decide what each person sees
  assert(!box.includes("/api/"));
  assert(box.includes("search={r.open as never}"));
});

Deno.test("find box: says when nothing matched, and which records it couldn't search", () => {
  assert(box.includes("data-find-empty"));
  assert(box.includes("data-find-failed"));
});

Deno.test("applications: the person opens their file, else their engine lead", () => {
  assert(sent.includes("file: r.application_id,") && sent.includes("elead: r.engine_lead_id,"));
  assert(sent.includes("data-open-record"));
});

Deno.test("email replies: the business opens its engine lead", () => {
  assert(replies.includes('search={{ view: "engine", elead: r.id }}'));
});

Deno.test("engine leads: a search looks through every tier and status", () => {
  assert(engine.includes('if (tier && !query) q = q.eq("tier", tier);'));
  assert(engine.includes('if (status && !query) q = q.eq("status", status);'));
  assert(engine.includes("data-search-all"));
});

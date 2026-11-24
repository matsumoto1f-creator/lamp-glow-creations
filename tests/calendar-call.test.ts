// deno test --node-modules-dir=none tests/calendar-call.test.ts
//
// 2026-11-24, Asad on eleven overdue "Try ... again" and "Call back ..." items: "give me a
// direction in what to do with these or make it convenient if calling them is what you want me
// to do here". Each call item now says what to do and carries the number to call.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { callSteps, callTo, eleadOf, itemView, leadsToCall } from "../src/lib/calendar.ts";
import page from "../src/components/staff/calendar.tsx" with { type: "text" };

Deno.test("call items: an open one says what to do; a done one and other kinds do not", () => {
  const na = callSteps({ rule: "lead_no_answer", status: "open" });
  const cb = callSteps({ rule: "lead_callback", status: "open" });
  assert(na?.startsWith("Call them.") && na.includes("Mark done"));
  assert(cb?.startsWith("Call them.") && cb.includes("open the lead and pick the new time"));
  assertEquals(callSteps({ rule: "lead_no_answer", status: "done" }), null);
  assertEquals(callSteps({ rule: "lead_callback", status: "cleared" }), null);
  assertEquals(callSteps({ rule: "offer_waiting", status: "open" }), null);
});

Deno.test("call items: the lead comes from the item's own link", () => {
  assertEquals(eleadOf("/staff?view=engine&elead=412"), 412);
  assertEquals(eleadOf("/staff?elead=7&view=engine"), 7);
  assertEquals(eleadOf("/staff?file=abc"), null);
  assertEquals(eleadOf("/staff?view=engine&elead=12abc"), null);
  assertEquals(eleadOf(null), null);
});

Deno.test("call items: only open call items are looked up, each lead once", () => {
  const link = (n: number) => `/staff?view=engine&elead=${n}`;
  assertEquals(
    leadsToCall([
      { rule: "lead_callback", status: "open", link: link(9) },
      { rule: "lead_no_answer", status: "open", link: link(3) },
      { rule: "lead_no_answer", status: "open", link: link(9) },
      { rule: "lead_no_answer", status: "done", link: link(4) },
      { rule: "email_reply", status: "open", link: link(5) },
      { rule: "lead_callback", status: "open", link: null },
    ]),
    [3, 9],
  );
});

Deno.test("call items: the saved contact's number comes first, with their name", () => {
  assertEquals(
    callTo({ phone: "(212) 555-0100", contact_phone: "1 908 555 0142", contact_name: " Dana " }),
    { tel: "+19085550142", shown: "908-555-0142", who: "Dana" },
  );
});

Deno.test("call items: with no usable contact number it is the business line, and no name", () => {
  // the name belongs to the contact number; asking the front desk for it is a different call
  assertEquals(callTo({ phone: "212.555.0100", contact_phone: "ext 4", contact_name: "Dana" }), {
    tel: "+12125550100",
    shown: "212-555-0100",
    who: null,
  });
});

Deno.test("call items: a number that can't be dialled offers no call", () => {
  assertEquals(callTo({ phone: "555-0100", contact_phone: null, contact_name: null }), null);
  assertEquals(callTo({ phone: null, contact_phone: "", contact_name: null }), null);
});

Deno.test("call items: Mark done stays the one main button", () => {
  const v = itemView(
    {
      id: "1",
      owner: null,
      rule: "lead_no_answer",
      title: "Try A again",
      why: "No answer.",
      link: "/staff?view=engine&elead=1",
      rep_slug: "asad",
      due_at: "2026-11-20T05:00:00Z",
      all_day: true,
      scheduled_at: "2026-11-20T05:00:00Z",
      status: "open",
      done_at: null,
      cleared_at: null,
    },
    new Date("2026-11-24T15:00:00Z"),
  );
  assertEquals(v.primary, { label: "Mark done", action: "done" });
  assertEquals(page.split("data-primary").length - 1, 1);
});

Deno.test("calendar page: the Call button shows only with steps and a number", () => {
  assert(page.includes("{steps && call && ("));
  assert(page.includes("href={`tel:${call.tel}`}"));
  // a done or cleared item gets no number at all
  assert(
    page.includes('call={i.status === "open" ? (p.calls?.[eleadOf(i.link) ?? -1] ?? null) : null}'),
  );
});

Deno.test(
  "calendar page: numbers are read as the signed-in person, and only the columns shown",
  () => {
    assert(page.includes('.select("id,phone,contact_phone,contact_name")'));
    const look = page.slice(page.indexOf("const wanted"), page.indexOf("const write"));
    assert(look.includes("getSupabase()") && !look.includes("/api/"));
  },
);

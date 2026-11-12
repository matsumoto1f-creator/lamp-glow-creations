// deno test --node-modules-dir=none tests/phone-start.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { fillInUrl, phoneStartProblem } from "../src/lib/phone-start.ts";

const ok = { email: "maria@example.com", phone: "", first_name: "Maria", business_name: "" };

Deno.test("the email comes first", () => {
  assertEquals(phoneStartProblem({ ...ok, email: "" }), "Get their email first.");
  assertEquals(phoneStartProblem({ ...ok, email: "  " }), "Get their email first.");
  assertEquals(
    phoneStartProblem({ ...ok, email: "maria@" }),
    "That email address doesn't look right.",
  );
});

Deno.test("a name or a business, and a cell only if it looks like one", () => {
  assertEquals(phoneStartProblem(ok), null);
  assertEquals(phoneStartProblem({ ...ok, first_name: "", business_name: "Joe's Pizza" }), null);
  assertEquals(
    phoneStartProblem({ ...ok, first_name: "", business_name: "" }),
    "Add their first name or business, so you know who it's for.",
  );
  assertEquals(phoneStartProblem({ ...ok, phone: "(718) 555-0142" }), null);
  assertEquals(
    phoneStartProblem({ ...ok, phone: "call me" }),
    "Numbers only for the cell, like (718) 555-0142.",
  );
});

Deno.test("fill-in mode is the link with fill=rep", () => {
  assertEquals(
    fillInUrl("https://getlamp.app/application/zeus?i=abc"),
    "https://getlamp.app/application/zeus?i=abc&fill=rep",
  );
  assertEquals(
    fillInUrl("https://getlamp.app/application/zeus"),
    "https://getlamp.app/application/zeus?fill=rep",
  );
});

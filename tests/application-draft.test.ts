// deno test --node-modules-dir=none tests/application-draft.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { safeDraft } from "../src/lib/application-draft.ts";

Deno.test("draft: SSNs and dates of birth never reach the server copy", () => {
  const d = safeDraft({
    business: { legal_name: "ISK Construction Corp." },
    owners: [
      { first: "Gjovalin", last: "Celaj", ssn: "123-45-6789", dob: "1980-01-02", email: "g@x.com" },
      { first: "Ana", ssn: "987654321", dob: "1982-03-04" },
      null,
    ],
  })!;
  const owners = d["owners"] as Record<string, unknown>[];
  assertEquals(owners[0]!["ssn"], "");
  assertEquals(owners[0]!["dob"], "");
  assertEquals(owners[1]!["ssn"], "");
  assertEquals(owners[0]!["email"], "g@x.com");
  assertEquals(owners[2], null);
  assert(!JSON.stringify(d).includes("6789"));
  assert(!JSON.stringify(d).includes("1980"));
});

Deno.test("draft: only an object is a draft", () => {
  assertEquals(safeDraft(null), null);
  assertEquals(safeDraft([1, 2]), null);
  assertEquals(safeDraft("x"), null);
  assertEquals(safeDraft({ business: {} }), { business: {} });
});

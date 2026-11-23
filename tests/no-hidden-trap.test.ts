// deno test --node-modules-dir=none tests/no-hidden-trap.test.ts
//
// 2026-11-23: a merchant with every answer in and both owners' signatures drawn pressed Sign and
// got only "Couldn't submit." The application pages carried a hidden box as a bot trap, and the
// server refused anything that arrived with it filled in. A browser's autofill fills hidden boxes
// too, so real people tripped it. No application had ever come back signed from a link.
import { assert } from "jsr:@std/assert@1";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import steps from "../src/components/application/link-application.tsx" with { type: "text" };
import paper from "../src/components/application/paper-application.tsx" with { type: "text" };

const submit = server.slice(
  server.indexOf("export async function submitApplication("),
  server.indexOf("// ---------- POST /api/application/upload"),
);

Deno.test("signing: nothing is refused for a hidden box being filled in", () => {
  assert(!/if \(body\.company_fax\)/.test(server));
  assert(!submit.includes('json(400, { error: "Couldn\'t submit." })'));
});

Deno.test(
  "signing: a page still open from before may send the old field, and it is accepted",
  () => {
    // the field stays in the body's type so an older page's request is still read
    assert(server.includes("company_fax?: unknown;"));
  },
);

Deno.test("signing: the limits that keep floods out are still there", () => {
  assert(submit.includes('svc.rpc("submit_link_application"'));
  assert(server.includes("too_many: ["));
});

Deno.test("pages: neither application page carries a hidden box or sends one", () => {
  for (const [name, page] of [
    ["step-by-step", steps],
    ["one-page", paper],
  ] as const) {
    assert(!page.includes("company_fax"), `${name} still sends it`);
    assert(!page.includes("honeypot"), `${name} still has the box`);
  }
});

Deno.test("signing: every refusal a merchant can see says what to do next", () => {
  const bare = [...submit.matchAll(/error: "([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((t) => t === "Couldn't submit.");
  assert(bare.length === 0, "a bare Couldn't submit. gives a merchant nothing to act on");
});

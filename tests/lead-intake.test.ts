// deno test --node-modules-dir=none tests/lead-intake.test.ts
//
// Leads come in one way: the application's first screen, through POST /api/application/start,
// which checks the per-network limit before it saves anything. The old POST /api/leads (the lead
// form of the /apply flow, removed 2026-11-27) took any answers and any rep's ref, so anyone could
// make fake leads and "Started on your link" alerts for any rep. These read the sources as text,
// so no file permission is needed. tests/server-stamp.local.ts checks the same against a running
// site and a local database.
import { assert, assertEquals } from "jsr:@std/assert@1";
import routeTree from "../src/routeTree.gen.ts" with { type: "text" };
import useAuth from "../src/hooks/use-auth.ts" with { type: "text" };
import start from "../src/lib/application-start.server.ts" with { type: "text" };

/** The paths the site answers, as the generated route tree lists them. */
const paths = new Set([...routeTree.matchAll(/\bpath: '([^']+)'/g)].map((m) => m[1]));

Deno.test("the site has no /api/leads route, so a post there gets a 404", () => {
  assert(paths.size > 10, "the route tree should list the site's paths");
  assertEquals(paths.has("/api/leads"), false);
  assertEquals(routeTree.includes("./routes/api.leads"), false);
});

Deno.test("the application's first screen is still a route", () => {
  assert(paths.has("/api/application/start"));
  assert(routeTree.includes("./routes/api.application.start"));
});

Deno.test("the browser no longer posts leads, and old /apply drafts are still saved", () => {
  assertEquals(useAuth.includes("/api/leads"), false);
  assertEquals(/\brecordLead\b/.test(useAuth), false);
  // the account page saves a finished pre-2026-11-19 /apply draft from this browser
  assert(useAuth.includes("export function saveDraftToAccount("));
});

Deno.test("the first screen checks the per-network limit before it saves the lead", () => {
  const limit = start.indexOf('"lead_intake_allowed"');
  const insert = start.search(/\.from\("leads"\)\s*\.insert\(/);
  assert(limit > 0, "the limit is checked");
  assert(insert > 0, "the lead is saved");
  assert(limit < insert, "the limit is checked before the insert");
  assert(start.slice(limit, insert).includes("429"), "a network over the limit gets a 429");
  // the insert carries the server's stamp (visitor()), which the leads table requires
  assert(/visitor\(\)\s*\.from\("leads"\)\s*\.insert\(/.test(start));
});

// deno test --node-modules-dir=none tests/metricool.test.ts
//
// Metricool's tag is an outside company's script. It loads on the public marketing pages only
// (Asad, 2026-11-24): never where a merchant types an SSN, never on an address that carries a
// merchant's private token, never in the staff portal.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { isMarketingPath, MARKETING_PATHS, METRICOOL_SCRIPT } from "../src/lib/metricool.ts";
import root from "../src/routes/__root.tsx" with { type: "text" };

type Script = { type?: string; async?: boolean; src?: string; onload?: () => void };

function run(pathname: string, referrer = "", host = "getlamp.app") {
  const scripts: Script[] = [];
  const calls: { hash: string }[] = [];
  const document = {
    referrer,
    createElement: (tag: string) => {
      assertEquals(tag, "script");
      return {};
    },
    head: { appendChild: (script: Script) => scripts.push(script) },
  };
  new Function("document", "beTracker", "location", METRICOOL_SCRIPT)(
    document,
    { t: (options: { hash: string }) => calls.push(options) },
    { pathname, host },
  );
  return { scripts, calls };
}

Deno.test("Metricool loads its website library before tracking with the supplied hash", () => {
  const { scripts, calls } = run("/");
  assertEquals(scripts.length, 1);
  assertEquals(scripts[0]?.src, "https://tracker.metricool.com/resources/be.js");
  assertEquals(scripts[0]?.async, true);
  assertEquals(calls, []);
  scripts[0]?.onload?.();
  assertEquals(calls, [{ hash: "d109dea0291b67a685c212489ab8f468" }]);
});

Deno.test("Metricool loads on every marketing page, with or without a trailing slash", () => {
  for (const p of MARKETING_PATHS) {
    assertEquals(run(p).scripts.length, 1, p);
    if (p !== "/") assertEquals(run(`${p}/`).scripts.length, 1, `${p}/`);
    assert(isMarketingPath(p));
  }
});

Deno.test("Metricool never loads where a merchant's details or private link are", () => {
  for (const p of [
    "/application",
    "/application/asad",
    "/application/asad/pdf",
    "/apply",
    "/apply/asad",
    "/account",
    "/login",
    "/staff",
    "/offer-check",
    "/upload/abc",
    "/reminders/stop",
    "/discord-link",
    "/about/team",
    "/a-page-added-later",
  ]) {
    assertEquals(run(p).scripts.length, 0, p);
    assert(!isMarketingPath(p), p);
  }
});

Deno.test("Metricool stays off when the visitor came from one of the site's private pages", () => {
  // the tag sends the earlier address along, and an application link's address holds the token
  assertEquals(run("/", "https://getlamp.app/application/asad?i=private").scripts.length, 0);
  assertEquals(run("/faq", "https://getlamp.app/staff").scripts.length, 0);
  // from another marketing page, from another site, or from nowhere: tracked
  assertEquals(run("/faq", "https://getlamp.app/").scripts.length, 1);
  assertEquals(run("/", "https://getlamp.app").scripts.length, 1);
  assertEquals(run("/", "https://www.google.com/search?q=lamp").scripts.length, 1);
  assertEquals(run("/", "").scripts.length, 1);
});

Deno.test("Metricool: the tag has one home, the root document", () => {
  assertEquals(root.split("METRICOOL_SCRIPT").length - 1, 2, "imported once, used once");
  assert(!root.includes("tracker.metricool.com"));
});

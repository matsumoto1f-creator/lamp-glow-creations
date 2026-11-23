import { assertEquals } from "jsr:@std/assert@1";
import { METRICOOL_SCRIPT } from "../src/lib/metricool.ts";

Deno.test("Metricool loads its website library before tracking with the supplied hash", () => {
  const scripts: { type?: string; async?: boolean; src?: string; onload?: () => void }[] = [];
  const calls: { hash: string }[] = [];
  const document = {
    createElement: (tag: string) => {
      assertEquals(tag, "script");
      return {};
    },
    head: {
      appendChild: (script: (typeof scripts)[number]) => scripts.push(script),
    },
  };

  new Function("document", "beTracker", METRICOOL_SCRIPT)(document, {
    t: (options: { hash: string }) => calls.push(options),
  });

  assertEquals(scripts.length, 1);
  assertEquals(scripts[0]?.src, "https://tracker.metricool.com/resources/be.js");
  assertEquals(scripts[0]?.async, true);
  assertEquals(calls, []);
  scripts[0]?.onload?.();
  assertEquals(calls, [{ hash: "d109dea0291b67a685c212489ab8f468" }]);
});

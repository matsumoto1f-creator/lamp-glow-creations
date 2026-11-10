// deno test --node-modules-dir=none tests/ai-key.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type KeyInfo, keyLine, keyProblem, tidyKey } from "../src/lib/ai-key.ts";

// made up for the tests: the right shape, not a real key
const GOOD = `sk-ant-test-${"a1B2c3D4".repeat(6)}`;
const day = (iso: string) => iso.slice(0, 10);
const info = (over: Partial<KeyInfo>): KeyInfo => ({
  source: null,
  saved: false,
  saved_by: null,
  saved_at: null,
  ...over,
});

Deno.test("a pasted key is tidied: line breaks, spaces and wrapping quotes go", () => {
  assertEquals(tidyKey(`  "${GOOD}"\n`), GOOD);
  assertEquals(tidyKey(`${GOOD.slice(0, 20)}\n${GOOD.slice(20)}`), GOOD);
  assertEquals(tidyKey(null), "");
  assertEquals(tidyKey(42), "");
});

Deno.test("a key that looks right passes; the rest say what's wrong", () => {
  assertEquals(keyProblem(GOOD), null);
  assertEquals(keyProblem(`  ${GOOD}  `), null);
  assertEquals(keyProblem(""), "Paste the key first.");
  assertEquals(keyProblem("   "), "Paste the key first.");
  assert(keyProblem("sk-proj-" + "a".repeat(60))?.includes("starts with sk-ant-"));
  assertEquals(keyProblem("sk-ant-short"), "That key is too short. Copy the whole key.");
  assertEquals(
    keyProblem("sk-ant-" + "a".repeat(400)),
    "That's longer than a key. Paste only the key.",
  );
  assertEquals(
    keyProblem("sk-ant-" + "a".repeat(40) + "<script>"),
    "A key holds only letters, numbers, dashes and underscores.",
  );
});

Deno.test("the page's line says where the key comes from, and never shows it", () => {
  assertEquals(keyLine(info({}), day), "Not set. Claude is off until a key is added.");
  assertEquals(
    keyLine(
      info({
        source: "saved",
        saved: true,
        saved_by: "Stevie Marshall",
        saved_at: "2026-11-10T15:00:00Z",
      }),
      day,
    ),
    "Saved here by Stevie Marshall on 2026-11-10.",
  );
  assertEquals(keyLine(info({ source: "saved", saved: true }), day), "Saved here.");
  assertEquals(keyLine(info({ source: "secrets" }), day), "Set in the server's secrets.");
  assertEquals(
    keyLine(info({ source: "secrets", saved: true, saved_by: "Asad" }), day),
    "Set in the server's secrets. The key saved here is not in use.",
  );
});

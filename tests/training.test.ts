// deno test --node-modules-dir=none tests/training.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { clock, TRAINING, trainingFor, trainingSrc } from "../src/lib/training.ts";

Deno.test("every video has its own slug, named for its role and part", () => {
  const slugs = TRAINING.map((v) => v.slug);
  assertEquals(new Set(slugs).size, slugs.length);
  for (const v of TRAINING) {
    assert(
      v.slug.startsWith(`${v.role}-${v.part}-`),
      `${v.slug} should start ${v.role}-${v.part}-`,
    );
    assert(/^[a-z0-9-]+$/.test(v.slug), `${v.slug} is not a plain file name`);
  }
});

Deno.test("each series runs part 1, 2, 3 ... with no gap, in the order it's listed", () => {
  for (const role of ["rep", "admin", "merchant"] as const) {
    assertEquals(
      trainingFor(role).map((v) => v.part),
      trainingFor(role).map((_, i) => i + 1),
    );
  }
});

Deno.test("every video has a title, a line on what it covers, and a real length", () => {
  for (const v of TRAINING) {
    assert(v.title.trim().length > 0, v.slug);
    assert(v.about.trim().length >= 10, v.slug);
    assert(Number.isInteger(v.sec) && v.sec >= 20 && v.sec <= 600, `${v.slug} length ${v.sec}`);
  }
});

Deno.test("wave 2 is on the right shelves: reps 8 and 9, admins 5, merchants 4", () => {
  const at = (slug: string) => TRAINING.find((v) => v.slug === slug)?.role;
  assertEquals(at("rep-8-messages"), "rep");
  assertEquals(at("rep-9-on-the-phone"), "rep");
  assertEquals(at("admin-5-ai-activity"), "admin");
  assertEquals(at("merchant-4-messages"), "merchant");
  assertEquals(trainingFor("rep").length, 9);
  assertEquals(trainingFor("admin").length, 5);
  assertEquals(trainingFor("merchant").length, 4);
});

Deno.test("the reps' note says seventeen minutes, and that's what the lengths add up to", () => {
  const minutes = trainingFor("rep").reduce((s, v) => s + v.sec, 0) / 60;
  assertEquals(Math.round(minutes), 17);
});

Deno.test("file paths and the clock", () => {
  assertEquals(trainingSrc("rep-8-messages", "mp4"), "/training/rep-8-messages.mp4");
  assertEquals(trainingSrc("rep-8-messages", "vtt"), "/training/rep-8-messages.vtt");
  assertEquals(clock(97), "1:37");
  assertEquals(clock(46), "0:46");
  assertEquals(clock(60), "1:00");
});

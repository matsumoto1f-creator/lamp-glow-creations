// deno test --node-modules-dir=none tests/emoji.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  addRecent,
  ALL_EMOJIS,
  EMOJI_GROUPS,
  insertEmoji,
  readRecent,
  RECENT_MAX,
} from "../src/lib/emoji.ts";

Deno.test("the picker's set: four groups, no emoji twice, each a real emoji", () => {
  assertEquals(
    EMOJI_GROUPS.map((g) => g.id),
    ["faces", "hands", "work", "signs"],
  );
  assertEquals(new Set(ALL_EMOJIS).size, ALL_EMOJIS.length);
  for (const e of ALL_EMOJIS) {
    assert(/\p{Extended_Pictographic}/u.test(e), `${e} is not an emoji`);
    assert(!/[A-Za-z0-9\s]/.test(e), `${e} holds plain text`);
  }
  for (const g of EMOJI_GROUPS) assert(g.emojis.length >= 8, `${g.id} is nearly empty`);
});

Deno.test("an emoji goes where the cursor is, and the cursor lands after it", () => {
  assertEquals(insertEmoji("Deal funded", 11, 11, "🎉", 4000), {
    text: "Deal funded🎉",
    caret: 13,
    added: true,
  });
  assertEquals(insertEmoji("Nice work", 0, 0, "👏", 4000).text, "👏Nice work");
  const mid = insertEmoji("Call  back", 5, 5, "📞", 4000);
  assertEquals(mid.text, "Call 📞 back");
  assertEquals(mid.text.slice(0, mid.caret), "Call 📞");
});

Deno.test("selected text is replaced by the emoji", () => {
  const r = insertEmoji("that is great news", 8, 13, "🔥", 4000);
  assertEquals(r.text, "that is 🔥 news");
  assertEquals(r.added, true);
});

Deno.test("no cursor yet (the box was never clicked): it goes on the end", () => {
  assertEquals(insertEmoji("On it", null, null, "👍", 4000).text, "On it👍");
  assertEquals(insertEmoji("On it", undefined, undefined, "👍", 4000).text, "On it👍");
  assertEquals(insertEmoji("", null, null, "👍", 4000), { text: "👍", caret: 2, added: true });
});

Deno.test("a stale or impossible cursor position can't mangle the message", () => {
  assertEquals(insertEmoji("Hi", 99, 120, "👋", 4000).text, "Hi👋");
  assertEquals(insertEmoji("Hi", -4, -1, "👋", 4000).text, "👋Hi");
  // end before start: treated as a plain cursor at start
  assertEquals(insertEmoji("Hello", 3, 1, "👋", 4000).text, "Hel👋lo");
  assertEquals(insertEmoji("Hello", Number.NaN, 2, "👋", 4000).text, "Hello👋");
});

Deno.test("a full message stays as it is", () => {
  const full = "x".repeat(4000);
  assertEquals(insertEmoji(full, 4000, 4000, "👍", 4000), {
    text: full,
    caret: 4000,
    added: false,
  });
  // one free character is not room for an emoji that takes two
  const nearly = "x".repeat(3999);
  assertEquals(insertEmoji(nearly, 3999, 3999, "👍", 4000).added, false);
  // but swapping selected text for one can fit
  assertEquals(insertEmoji(full, 0, 2, "👍", 4000).added, true);
  assertEquals(insertEmoji("Hi", 2, 2, "", 4000).added, false);
});

Deno.test("recently used: newest first, no repeats, capped", () => {
  assertEquals(addRecent([], "👍"), ["👍"]);
  assertEquals(addRecent(["👍", "🔥"], "🔥"), ["🔥", "👍"]);
  let list: string[] = [];
  for (const e of ALL_EMOJIS.slice(0, RECENT_MAX + 5)) list = addRecent(list, e);
  assertEquals(list.length, RECENT_MAX);
  assertEquals(list[0], ALL_EMOJIS[RECENT_MAX + 4]);
});

Deno.test("what the browser saved is read back safely", () => {
  assertEquals(readRecent(JSON.stringify(["🔥", "👍", "🔥"])), ["🔥", "👍"]);
  assertEquals(readRecent(null), []);
  assertEquals(readRecent("not json"), []);
  assertEquals(readRecent(JSON.stringify({ a: 1 })), []);
  // anything that isn't one of the picker's emojis is dropped, text and markup included
  assertEquals(readRecent(JSON.stringify(["<img src=x>", "hello", 7, null, "👍"])), ["👍"]);
  assertEquals(readRecent(JSON.stringify(ALL_EMOJIS)).length, RECENT_MAX);
});

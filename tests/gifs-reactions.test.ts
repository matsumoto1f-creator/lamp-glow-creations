// deno test --node-modules-dir=none tests/gifs-reactions.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  gifKeyProblem,
  gifPreview,
  isGifUrl,
  KLIPY_PLACEHOLDER,
  klipyUrl,
  parseKlipy,
} from "../src/lib/gifs.ts";
import {
  groupReactions,
  MAX_OWN_REACTIONS,
  nextReaction,
  QUICK_REACTIONS,
  reactionLabel,
} from "../src/lib/reactions.ts";
import { ALL_EMOJIS } from "../src/lib/emoji.ts";

// the shape KLIPY documents for a GIF's address
const GIF = "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.gif";
const WEBP = "https://static2.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/eUbp2uNc.webp";

Deno.test("a GIF message is a KLIPY media address and nothing else", () => {
  assert(isGifUrl(GIF));
  assert(isGifUrl(WEBP));
  assert(isGifUrl("https://static1.klipy.com/ii/abc/def/ghi/x.gif?v=2&t=abc"));
  for (const bad of [
    "http://static.klipy.com/ii/abc/def/ghi/x.gif", // not https
    "https://static.klipy.com.evil.test/ii/abc/def/x.gif", // another host dressed up
    "https://evil.test/https://static.klipy.com/ii/abc/def/x.gif",
    "https://static3.klipy.com/ii/abc/def/ghi/x.gif", // not one of KLIPY's three
    "https://api.klipy.com/ii/abc/def/ghi/x.gif",
    "https://static.klipy.com/ii/abc/../../x.gif", // climbing out
    "https://static.klipy.com/ii/abc/def/ghi/x.svg", // not a GIF
    "https://static.klipy.com/ii/abc/def/ghi/x.gif#<script>",
    "https://static.klipy.com/ii/abc/def/ghi/x.gif onerror=alert(1)",
    `look at this ${GIF}`, // a sentence with an address in it stays text
    `${GIF}\n${GIF}`,
    "javascript:alert(1)",
    "",
    null,
    42,
  ])
    assert(!isGifUrl(bad), `should refuse ${String(bad)}`);
  assert(!isGifUrl(`https://static.klipy.com/${"a".repeat(600)}.gif`));
});

Deno.test("the inbox says Sent a GIF, and leaves ordinary messages alone", () => {
  assertEquals(gifPreview(GIF), "Sent a GIF");
  assertEquals(gifPreview("Morning. Ten new leads each today."), null);
  assertEquals(gifPreview(null), null);
});

Deno.test("where the search goes: trending with no words, search with them", () => {
  const t = new URL(klipyUrl("KEY123abc", "  ", "cust1"));
  assertEquals(t.origin + t.pathname, "https://api.klipy.com/api/v1/KEY123abc/gifs/trending");
  assertEquals(t.searchParams.get("q"), null);
  const s = new URL(klipyUrl("KEY123abc", "  deal   closed ", "cust1", 2));
  assertEquals(s.pathname, "/api/v1/KEY123abc/gifs/search");
  assertEquals(s.searchParams.get("q"), "deal closed");
  assertEquals(s.searchParams.get("page"), "2");
  assertEquals(s.searchParams.get("customer_id"), "cust1");
  // work chat: the strictest content filter, always
  assertEquals(s.searchParams.get("content_filter"), "high");
  assertEquals(t.searchParams.get("content_filter"), "high");
  // a key can't break out of its place in the address
  assert(klipyUrl("a/b?c", "x", "c").startsWith("https://api.klipy.com/api/v1/a%2Fb%3Fc/gifs/"));
  assertEquals(new URL(klipyUrl("k", "x", "c", -5)).searchParams.get("page"), "1");
  assertEquals(new URL(klipyUrl("k", "y".repeat(300), "c")).searchParams.get("q")?.length, 80);
  assertEquals(KLIPY_PLACEHOLDER, "Search KLIPY");
});

Deno.test("KLIPY's answer becomes tiles, in KLIPY's order, each one sendable", () => {
  const size = (name: string) => ({
    gif: { url: `https://static.klipy.com/ii/hash/aa/bb/${name}.gif`, width: 200, height: 150 },
    webp: { url: `https://static.klipy.com/ii/hash/aa/bb/${name}.webp`, width: 200, height: 150 },
  });
  const r = parseKlipy({
    result: true,
    data: {
      has_next: true,
      data: [
        {
          id: 1,
          slug: "hello",
          title: "Hello",
          file: { hd: size("h1"), md: size("m1"), sm: size("s1") },
        },
        // only a big one on offer: still usable
        { id: 2, slug: "wow", title: "", file: { hd: size("h2") } },
        // media somewhere else: left out, never shown
        {
          id: 3,
          title: "Bad",
          file: { md: { gif: { url: "https://evil.test/x.gif", width: 1, height: 1 } } },
        },
        { id: 4, title: "No files" },
        null,
        { id: 5, slug: "bye", title: "Bye", file: { md: size("m5"), sm: size("s5") } },
      ],
    },
  });
  assertEquals(r.error, null);
  assertEquals(r.more, true);
  assertEquals(
    r.gifs.map((g) => g.id),
    ["1", "2", "5"],
  );
  // the grid shows the small WebP; what's sent is the medium GIF
  assertEquals(r.gifs[0]!.preview.url, "https://static.klipy.com/ii/hash/aa/bb/s1.webp");
  assertEquals(r.gifs[0]!.send.url, "https://static.klipy.com/ii/hash/aa/bb/m1.gif");
  assertEquals(r.gifs[1]!.title, "GIF");
  assertEquals(r.gifs[1]!.send.url, "https://static.klipy.com/ii/hash/aa/bb/h2.webp");
  for (const g of r.gifs) assert(isGifUrl(g.send.url) && isGifUrl(g.preview.url));
});

Deno.test("when KLIPY says no, the person is told why in plain words", () => {
  assertEquals(
    parseKlipy({ result: false, errors: { message: ["The provided API key is invalid."] } }).error,
    "KLIPY refused Lamp's app key. An admin needs to check it.",
  );
  assertEquals(parseKlipy(null).error, "KLIPY didn't answer. Try again in a minute.");
  assertEquals(parseKlipy({ result: false }).gifs, []);
  assertEquals(parseKlipy({ result: true, data: {} }), { gifs: [], more: false, error: null });
});

Deno.test("a pasted KLIPY key is checked before it's tried", () => {
  assertEquals(gifKeyProblem("AbCd1234EfGh5678"), null);
  assertEquals(gifKeyProblem("  AbCd1234EfGh5678  "), null);
  assertEquals(gifKeyProblem(""), "Paste the KLIPY app key first.");
  assertEquals(gifKeyProblem("abc"), "That key is too short. Copy the whole key.");
  assertEquals(gifKeyProblem("AbCd 1234 EfGh"), "A KLIPY app key has no spaces. Copy it again.");
  assertEquals(
    gifKeyProblem("AbCd1234/EfGh<5678>"),
    "A key holds only letters, numbers, dots and dashes.",
  );
  assertEquals(gifKeyProblem("k".repeat(300)), "That's longer than a key. Paste only the key.");
});

const rows = [
  { message_id: 10, user_id: "stevie", emoji: "🔥" },
  { message_id: 10, user_id: "jordan", emoji: "🔥" },
  { message_id: 10, user_id: "jordan", emoji: "👍" },
  { message_id: 11, user_id: "stevie", emoji: "😂" },
  { message_id: 10, user_id: "jordan", emoji: "🔥" }, // a repeated row counts once
];

Deno.test("reactions become chips: one per emoji, counted, the reader's own marked", () => {
  const g = groupReactions(rows, "jordan");
  assertEquals(g.get(10), [
    { emoji: "🔥", count: 2, mine: true },
    { emoji: "👍", count: 1, mine: true },
  ]);
  assertEquals(g.get(11), [{ emoji: "😂", count: 1, mine: false }]);
  assertEquals(g.get(12), undefined);
  // the same rows, read by someone else
  assertEquals(groupReactions(rows, "tasha").get(10)![0], { emoji: "🔥", count: 2, mine: false });
  assertEquals(groupReactions([], "jordan").size, 0);
});

Deno.test(
  "tapping an emoji puts it on, tapping your own takes it off, and six is the limit",
  () => {
    const chips = groupReactions(rows, "jordan").get(10);
    assertEquals(nextReaction(chips, "🔥"), "remove");
    assertEquals(nextReaction(chips, "🎉"), "add");
    assertEquals(nextReaction(undefined, "🎉"), "add");
    // someone else's reaction is not yours to take off: tapping it adds yours
    assertEquals(nextReaction(groupReactions(rows, "tasha").get(10), "🔥"), "add");
    const full = ALL_EMOJIS.slice(0, MAX_OWN_REACTIONS).map((emoji) => ({
      emoji,
      count: 1,
      mine: true,
    }));
    assertEquals(nextReaction(full, "🎉"), "full");
    assertEquals(nextReaction(full, full[0]!.emoji), "remove");
    assertEquals(MAX_OWN_REACTIONS, 6);
  },
);

Deno.test(
  "the quick picks are six of the picker's own emojis, and a chip reads aloud sensibly",
  () => {
    assertEquals(QUICK_REACTIONS.length, 6);
    for (const e of QUICK_REACTIONS) assert(ALL_EMOJIS.includes(e), `${e} is not in the picker`);
    assertEquals(
      reactionLabel({ emoji: "🔥", count: 1, mine: true }),
      "🔥 1 person, including you. Tap to take yours off.",
    );
    assertEquals(
      reactionLabel({ emoji: "👍", count: 3, mine: false }),
      "👍 3 people. Tap to add yours.",
    );
  },
);

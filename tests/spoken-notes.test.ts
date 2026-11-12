// deno test --node-modules-dir=none tests/spoken-notes.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { fitTo, joinSpoken, paperLink } from "../src/lib/spoken-notes.ts";

Deno.test("joinSpoken starts empty notes with a capital and a full stop", () => {
  assertEquals(
    joinSpoken("", "needs fifty thousand for payroll"),
    "Needs fifty thousand for payroll.",
  );
});

Deno.test("joinSpoken adds a new sentence after a full stop", () => {
  assertEquals(
    joinSpoken("Owner is Maria.", "call back thursday after two"),
    "Owner is Maria. Call back thursday after two.",
  );
});

Deno.test("joinSpoken carries on a sentence that has no ending yet", () => {
  assertEquals(joinSpoken("Wants it by", "friday"), "Wants it by friday.");
});

Deno.test("joinSpoken keeps the speaker's own punctuation and tidies spaces", () => {
  assertEquals(joinSpoken("Note:  ", "  has two   positions?  "), "Note: Has two positions?");
});

Deno.test("joinSpoken ignores silence", () => {
  assertEquals(joinSpoken("Already here.", "   "), "Already here.");
});

Deno.test("fitTo cuts at a word, not through one", () => {
  assertEquals(fitTo("short", 10), "short");
  assertEquals(fitTo("one two three four", 13), "one two three");
});

Deno.test("paperLink turns a personal link into the paper one", () => {
  assertEquals(
    paperLink("https://getlamp.app/application/zeus?i=abc123"),
    "https://getlamp.app/application/zeus/pdf?i=abc123",
  );
  assertEquals(
    paperLink("/application/zeus?i=abc&fill=rep"),
    "/application/zeus/pdf?i=abc&fill=rep",
  );
  assertEquals(
    paperLink("https://getlamp.app/application/zeus"),
    "https://getlamp.app/application/zeus/pdf",
  );
});

Deno.test("paperLink leaves paper links and other pages alone", () => {
  assertEquals(
    paperLink("https://getlamp.app/application/zeus/pdf?i=abc"),
    "https://getlamp.app/application/zeus/pdf?i=abc",
  );
  assertEquals(paperLink("https://getlamp.app/apply/zeus"), "https://getlamp.app/apply/zeus");
  assertEquals(paperLink("/application/zeus/?i=x#top"), "/application/zeus/pdf?i=x#top");
});

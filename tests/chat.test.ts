// deno test --node-modules-dir=none tests/chat.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  authorLabel,
  chatError,
  chatMissing,
  chatRefusal,
  firstName,
  MAX_LENGTH,
  REFUSED_TEXT,
  unreadCount,
} from "../src/lib/chat.ts";

Deno.test("numbers that don't belong in chat are refused", () => {
  for (const text of [
    "his ssn is 123-45-6789",
    "ssn 123 45 6789",
    "123456789",
    "routing 021000021",
    "acct 000123456789",
    "EIN 12-3456789",
    "card 4111 1111 1111 1111",
    "card 4111-1111-1111-1111",
    "+12015550123",
  ]) {
    assertEquals(chatRefusal(text), REFUSED_TEXT, text);
  }
});

Deno.test("everyday team messages pass", () => {
  for (const text of [
    "Call him at 201-555-0123",
    "(201) 555-0123 works",
    "201 555 0123",
    "They need $150,000 by Friday",
    "About 1,250,000 a year in deposits",
    "Statements for March 2026 are in",
    "Zip is 07030",
  ]) {
    assertEquals(chatRefusal(text), null, text);
  }
});

Deno.test("empty and overlong messages are stopped before sending", () => {
  assertEquals(chatRefusal("   "), "Write a message first.");
  assertEquals(chatRefusal("a".repeat(MAX_LENGTH + 1)), "Keep a message under 4,000 characters.");
  assertEquals(chatRefusal("a".repeat(MAX_LENGTH)), null);
});

Deno.test("each message shows its real author, and yours says You", () => {
  const me = "u-me";
  const rep = { author: "u-rep", author_role: "rep" as const, author_name: "Darrell Jones" };
  assertEquals(authorLabel(rep, me), "Darrell Jones");
  assertEquals(authorLabel({ ...rep, author: me }, me), "You");
  assertEquals(authorLabel({ author: null, author_role: "system", author_name: null }, me), "Lamp");
  assertEquals(authorLabel({ ...rep, author_name: null }, me), "Lamp");
  assertEquals(firstName("  Stevie   Marshall "), "Stevie");
});

Deno.test("refusals the database explains are shown in its words; anything else is generic", () => {
  assertEquals(chatError({ code: "22023", message: REFUSED_TEXT }), REFUSED_TEXT);
  assertEquals(
    chatError({
      code: "42501",
      message: 'new row violates row-level security policy for table "chat_messages"',
    }),
    "You can read this conversation but can't write in it.",
  );
  assertEquals(
    chatError({ code: "42501", message: "Only admins make rooms." }),
    "Only admins make rooms.",
  );
  assertEquals(
    chatError({ code: "08006", message: "connection lost at 10.0.0.1" }),
    "That didn't send. Check your connection and try again.",
  );
  assertEquals(chatError(null), "");
});

Deno.test("the Messages tab hides itself until its SQL has run", () => {
  assert(chatMissing({ code: "PGRST202" }));
  assert(chatMissing({ code: "42P01" }));
  assert(!chatMissing({ code: "42501" }));
  assert(!chatMissing(null));
});

Deno.test("the tab and the bell count conversations with something new", () => {
  assertEquals(unreadCount([{ unread: true }, { unread: false }, { unread: true }]), 2);
  assertEquals(unreadCount([]), 0);
});

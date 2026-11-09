// deno test --node-modules-dir=none tests/chat.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  authorLabel,
  chatError,
  chatMissing,
  chatRefusal,
  contactName,
  firstName,
  lendingWords,
  MAX_LENGTH,
  nudgeEmail,
  REFUSED_TEXT,
  unreadCount,
} from "../src/lib/chat.ts";

Deno.test("numbers that belong in the secure application are refused", () => {
  for (const text of [
    "my ssn is 123-45-6789",
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

Deno.test("everyday messages pass", () => {
  for (const text of [
    "Call me at 201-555-0123",
    "(201) 555-0123 works",
    "201 555 0123",
    "I need $150,000 by Friday",
    "We do about 1,250,000 a year",
    "Statements for March 2026 are attached",
    "Zip is 07030",
  ]) {
    assertEquals(chatRefusal(text), null, text);
  }
});

Deno.test("empty and overlong messages are stopped before sending", () => {
  assertEquals(chatRefusal("   "), "Write a message first.");
  assert(chatRefusal("a".repeat(MAX_LENGTH + 1))?.startsWith("Keep a message under"));
  assertEquals(chatRefusal("a".repeat(MAX_LENGTH)), null);
});

Deno.test("staff are warned about lending words, once each, as typed", () => {
  assertEquals(lendingWords("Your Loan is approved, the loan amount and lender"), [
    "Loan",
    "lender",
  ]);
  assertEquals(lendingWords("We're not lending, no APR, no interest rate"), [
    "lending",
    "APR",
    "interest rate",
  ]);
  assertEquals(lendingWords("Your advance is approved: $50,000, 120 daily payments"), []);
  assertEquals(lendingWords("Blending the statements"), []);
});

Deno.test("the merchant sees the same contact the application emails name", () => {
  const reps = [
    { slug: "darrell", name: "Darrell Jones", admin_slug: "zeus" },
    { slug: "zeus", name: "Zeus Smith", admin_slug: null },
    { slug: "solo", name: "Sam Solo", admin_slug: null },
  ];
  assertEquals(contactName("darrell", reps), "Zeus");
  assertEquals(contactName("solo", reps), "Sam");
  assertEquals(contactName(null, reps), "the Lamp team");
  assertEquals(contactName("gone", reps), "the Lamp team");
  // the lead's row didn't load: fall back to the rep
  assertEquals(contactName("darrell", [reps[0]!]), "Darrell");
});

Deno.test("each message shows its real author", () => {
  const me = "u-me";
  const rep = { author: "u-rep", author_role: "rep" as const, author_name: "Darrell Jones" };
  const merchant = { author: "u-m", author_role: "merchant" as const, author_name: "Maria" };
  const lamp = { author: null, author_role: "system" as const, author_name: "Lamp" };
  assertEquals(authorLabel(rep, "merchant", me), "Darrell at Lamp");
  assertEquals(authorLabel(rep, "staff", me), "Darrell Jones");
  assertEquals(authorLabel(merchant, "staff", me), "Maria (merchant)");
  assertEquals(authorLabel({ ...merchant, author: me }, "merchant", me), "You");
  assertEquals(authorLabel(lamp, "merchant", me), "Lamp");
  assertEquals(firstName("  Stevie   Marshall "), "Stevie");
});

Deno.test("refusals the database explains are shown in its words; anything else is generic", () => {
  assertEquals(chatError({ code: "22023", message: REFUSED_TEXT }), REFUSED_TEXT);
  assertEquals(chatError({ code: "42501", message: "Not your file." }), "Not your file.");
  assertEquals(
    chatError({ code: "08006", message: "connection lost at 10.0.0.1" }),
    "That didn't send. Check your connection and try again.",
  );
  assertEquals(chatError(null), "");
});

Deno.test("the conversation hides itself until its SQL has run", () => {
  assert(chatMissing({ code: "PGRST202" }));
  assert(chatMissing({ code: "42P01" }));
  assert(!chatMissing({ code: "42501" }));
  assert(!chatMissing(null));
});

Deno.test("the refusal itself never calls an MCA lending", () => {
  assertEquals(lendingWords(REFUSED_TEXT), []);
});

Deno.test("the nudge email names who wrote and links to the account, never the message", () => {
  const m = nudgeEmail({ firstName: "Maria", contact: "Zeus Smith", site: "https://getlamp.app/" });
  assertEquals(m.subject, "New message about your Lamp file");
  assert(m.text.startsWith("Hi Maria,"));
  assert(m.text.includes("Zeus Smith sent you a message about your Lamp file."));
  assert(m.text.includes("https://getlamp.app/account#messages"));
  assert(m.html.includes('href="https://getlamp.app/account#messages"'));
  assert(m.text.includes("please answer in Lamp"));
  assertEquals(lendingWords(`${m.subject} ${m.text} ${m.html}`), []);
});

Deno.test("the nudge email copes with no name and escapes what it's given", () => {
  const m = nudgeEmail({ firstName: "  ", contact: "", site: "https://getlamp.app" });
  assert(m.text.startsWith("Hi,"));
  assert(m.text.includes("Your Lamp rep sent you a message"));
  const x = nudgeEmail({
    firstName: "<b>Al</b>",
    contact: 'Ray "R" & Co',
    site: "https://getlamp.app",
  });
  assert(x.html.includes("Hi &lt;b&gt;Al&lt;/b&gt;,"));
  assert(x.html.includes("Ray &quot;R&quot; &amp; Co"));
  assert(!x.html.includes("<b>Al</b>"));
});

Deno.test("the Messages tab counts conversations with something new", () => {
  assertEquals(unreadCount([{ unread: true }, { unread: false }, { unread: true }]), 2);
  assertEquals(unreadCount([]), 0);
});

Deno.test("reading a conversation you can't write in says so plainly", () => {
  assertEquals(
    chatError({
      code: "42501",
      message: 'new row violates row-level security policy for table "chat_messages"',
    }),
    "You can read this conversation but can't write in it.",
  );
});

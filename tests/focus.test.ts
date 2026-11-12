// deno test --node-modules-dir=none tests/focus.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { countToday, dayStart, inFocusPilot, ringFill, ringLine } from "../src/lib/focus.ts";

const now = new Date(2026, 10, 9, 15, 30); // 3:30 PM on the rep's own clock
const today = (h: number) => new Date(2026, 10, 9, h, 0).toISOString();
const yesterday = new Date(2026, 10, 8, 16, 0).toISOString();
const lead = (status: string, notes: string | null, worked_at: string | null) => ({
  status,
  notes,
  worked_at,
});

Deno.test("a conversation is a lead spoken to today, with a note", () => {
  const c = countToday(
    [
      lead("called", "Wants 40k for inventory, call Thursday.", today(9)),
      lead("callback", "Busy, try after 2.", today(10)),
      lead("qualified", "Two years in, 60k a month.", today(11)),
    ],
    now,
  );
  assertEquals(c, { conversations: 3, missingNote: 0 });
});

Deno.test("no answer and untouched leads never count", () => {
  const c = countToday(
    [lead("no_answer", "Left a voicemail.", today(9)), lead("new", "Looks good.", today(9))],
    now,
  );
  assertEquals(c, { conversations: 0, missingNote: 0 });
});

Deno.test("spoke but wrote nothing: not counted, and flagged so a note fixes it", () => {
  const c = countToday(
    [
      lead("called", "", today(9)),
      lead("called", "  ", today(10)),
      lead("called", null, today(11)),
    ],
    now,
  );
  assertEquals(c, { conversations: 0, missingNote: 3 });
});

Deno.test("not a fit and do not call count like any other conversation", () => {
  const c = countToday(
    [
      lead("dead", "Sold the business last year.", today(9)),
      lead("do_not_call", "Asked not to be called again.", today(10)),
    ],
    now,
  );
  assertEquals(c.conversations, 2);
});

Deno.test("yesterday's work doesn't carry into today", () => {
  const c = countToday(
    [lead("called", "Good talk.", yesterday), lead("called", "Good talk.", null)],
    now,
  );
  assertEquals(c, { conversations: 0, missingNote: 0 });
  assertEquals(dayStart(now).getHours(), 0);
});

Deno.test("the ring fills to the target and stops; the words keep up", () => {
  assertEquals(ringFill(0), 0);
  assertEquals(ringFill(5), 0.25);
  assertEquals(ringFill(20), 1);
  assertEquals(ringFill(27), 1);
  assertEquals(ringLine(0), "First one starts the day.");
  assertEquals(ringLine(7), "13 to go.");
  assertEquals(ringLine(20), "Target hit.");
  assertEquals(ringLine(23), "3 past target.");
});

Deno.test("the pilot is Asad and Stevie", () => {
  assertEquals(inFocusPilot("asad"), true);
  assertEquals(inFocusPilot("stevie"), true);
  assertEquals(inFocusPilot("zeus"), false);
  assertEquals(inFocusPilot(null), false);
});

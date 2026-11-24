// deno test --node-modules-dir=none tests/calendar-month.test.ts
//
// 2026-11-24, Asad: "can the calendar show up as an actual calendar". The calendar opens on a
// month grid; pressing a day shows that day's cards under it.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { daySquare, monthGrid, monthOf, sayMonth, shiftMonth } from "../src/lib/calendar.ts";
import page from "../src/components/staff/calendar.tsx" with { type: "text" };

Deno.test("month grid: whole weeks, Monday first, covering every day of the month", () => {
  const nov = monthGrid("2026-11-24");
  assertEquals(nov.length, 6); // Nov 1 2026 is a Sunday, Nov 30 a Monday
  assertEquals(nov[0], [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ]);
  assertEquals(nov[5]![0], "2026-11-30");
  assertEquals(nov[5]![6], "2026-12-06");
  for (const w of nov) assertEquals(w.length, 7);
  const days = nov.flat();
  for (let d = 1; d <= 30; d++) assert(days.includes(`2026-11-${String(d).padStart(2, "0")}`));
  assertEquals(new Set(days).size, days.length);
});

Deno.test("month grid: a month that fits four weeks has four rows, a usual one five", () => {
  // February 2027 starts on a Monday and has 28 days
  const feb = monthGrid("2027-02-10");
  assertEquals(feb.length, 4);
  assertEquals(feb[0]![0], "2027-02-01");
  assertEquals(feb[3]![6], "2027-02-28");
  assertEquals(monthGrid("2026-12-15").length, 5);
});

Deno.test("month grid: the same grid whichever day of the month is picked", () => {
  assertEquals(monthGrid("2026-11-01"), monthGrid("2026-11-30"));
});

Deno.test(
  "month: moving a month keeps the day, or lands on the last day of a shorter month",
  () => {
    assertEquals(shiftMonth("2026-11-24", 1), "2026-12-24");
    assertEquals(shiftMonth("2026-12-24", 1), "2027-01-24");
    assertEquals(shiftMonth("2026-01-15", -1), "2025-12-15");
    assertEquals(shiftMonth("2027-01-31", 1), "2027-02-28");
    assertEquals(shiftMonth("2028-01-31", 1), "2028-02-29");
    assertEquals(shiftMonth("2026-03-31", -1), "2026-02-28");
  },
);

Deno.test("month: its name and key", () => {
  assertEquals(sayMonth("2026-11-24"), "November 2026");
  assertEquals(sayMonth("2026-11-01"), "November 2026");
  assertEquals(monthOf("2026-11-24"), "2026-11");
});

Deno.test("month: a square shows the first three items and counts the rest", () => {
  assertEquals(daySquare([1, 2]), { shown: [1, 2], more: 0 });
  assertEquals(daySquare([1, 2, 3, 4, 5]), { shown: [1, 2, 3], more: 2 });
  assertEquals(daySquare([]), { shown: [], more: 0 });
});

Deno.test("calendar page: opens on the month, with the other views still there", () => {
  assert(page.includes('useState<Mode>("month")'));
  for (const m of ["Month", "Agenda", "Day", "Week"]) assert(page.includes(`label: "${m}"`));
});

Deno.test("calendar page: pressing a day shows its cards under the grid", () => {
  assert(page.includes("onClick={() => onDay(d)}"));
  const month = page.slice(
    page.indexOf('p.mode === "month" ? ('),
    page.indexOf('p.mode === "agenda" ? ('),
  );
  assert(month.includes("<Month") && month.includes("<DayList"));
  // today's overdue items are not hidden behind the grid
  assert(month.includes("<Slipped"));
});

Deno.test("calendar page: the arrows move a month in the month view", () => {
  assert(page.includes('p.mode === "month" ? shiftMonth(p.day, n) : shiftDay(p.day, n * step)'));
  assert(
    page.includes("aria-label={`Previous ${span}`}") &&
      page.includes("aria-label={`Next ${span}`}"),
  );
});

Deno.test("calendar page: a square says what is on it for someone who can't see it", () => {
  assert(page.includes('"nothing scheduled"'));
  assert(page.includes("aria-pressed={d === day}"));
});

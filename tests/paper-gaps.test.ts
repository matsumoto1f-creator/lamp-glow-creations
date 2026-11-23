// deno test --node-modules-dir=none tests/paper-gaps.test.ts
//
// 2026-11-23: a merchant whose rep had filled the one-page application in with them could not
// send it. All that was left was their SSN and date of birth; on a phone those are two boxes about
// 6 px tall on a picture of the form, and the page only said "fill in the boxes marked in red".
// These hold the way out: a card that says what is left, a button that opens the missing boxes one
// after another, and an editor box that takes typing when reached with the keyboard's Next key.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  fixTarget,
  gapHeadline,
  gapList,
  isQuestionGap,
  nextGap,
  QUESTION_GAPS,
} from "../src/lib/paper-gaps.ts";
import page from "../src/components/application/paper-application.tsx" with { type: "text" };
import signBlock from "../src/components/application/sign-block.tsx" with { type: "text" };
import paperForm from "../src/lib/paper-form.ts" with { type: "text" };
import details from "../src/lib/application-details.ts" with { type: "text" };

Deno.test("gaps: Next goes to the next unfinished box and wraps to the top", () => {
  assertEquals(nextGap([31, 32], 31), 32);
  assertEquals(nextGap([32], 31), 32);
  assertEquals(nextGap([5, 31], 31), 5);
  assertEquals(nextGap([40, 5, 31], 31), 40);
});

Deno.test(
  "gaps: with no other box unfinished there is nowhere to go, so the button says Done",
  () => {
    assertEquals(nextGap([], 31), null);
    assertEquals(nextGap([31], 31), null);
  },
);

Deno.test("gaps: the button goes to the first unfinished box in reading order", () => {
  assertEquals(fixTarget([32, 31], ["owner's date of birth", "owner's SSN (nine digits)"]), {
    kind: "box",
    index: 31,
  });
});

Deno.test("gaps: with the boxes done, the button goes to the two questions under the form", () => {
  for (const q of QUESTION_GAPS) assertEquals(fixTarget([], [q]), { kind: "questions" });
  assertEquals(fixTarget([], []), null);
  assertEquals(fixTarget([], ["something that is neither a box nor a question"]), null);
});

Deno.test(
  "gaps: the two questions are worded exactly as the application's own list words them",
  () => {
    // missing() in application-details.ts is where the wording comes from; a reworded item there
    // would leave the button with nowhere to go
    for (const q of QUESTION_GAPS) {
      assert(details.includes(`"${q}"`), `application-details.ts no longer says: ${q}`);
      assert(isQuestionGap(q));
    }
    assert(!isQuestionGap("owner's SSN (nine digits)"));
  },
);

Deno.test("gaps: the card says how many things are left and who filled the rest in", () => {
  assertEquals(
    gapHeadline(["owner's date of birth", "owner's SSN (nine digits)"], "Asad"),
    "Asad filled this in with you. 2 things left for you to add:",
  );
  assertEquals(gapHeadline(["owner's date of birth"], null), "1 thing left before you can sign:");
});

Deno.test("gaps: a long list is cut, and says how many more", () => {
  assertEquals(gapList(["a", "b"]), "a, b");
  assertEquals(gapList(["a", "b", "c", "d", "e", "f", "g"]), "a, b, c, d, e and 2 more");
});

Deno.test("paper form: the unfinished boxes come from the same rule that marks them red", () => {
  assert(paperForm.includes("export const gapIndexes"));
  const gaps = paperForm.slice(paperForm.indexOf("export const gapIndexes"));
  assert(gaps.slice(0, 200).includes('x.kind === "field" && !!x.ok && !x.ok(d)'));
  assert(paperForm.includes('x.kind === "field" && !!x.ok && !x.ok(d)).map('));
});

Deno.test(
  "paper page: a merchant gets the card and the button; a rep on the phone does not",
  () => {
    const card = page.slice(page.indexOf("data-paper-gaps") - 400, page.indexOf("data-paper-gaps"));
    assert(card.includes("!phoneMode && todo.length > 0 && (repFilled || tried)"));
    assert(page.includes("onFix={fix}"), "the button over Sign is wired");
    // the rep's own screen ends in HandOff, not SignBlock, so it never shows the button
    const signArea = page.slice(
      page.indexOf("{phoneMode && token ? ("),
      page.indexOf("onFix={fix}"),
    );
    assert(signArea.includes("<HandOff") && signArea.includes("<SignBlock"));
  },
);

Deno.test("paper page: a form the rep filled in says so before the merchant tries to sign", () => {
  assert(
    page.includes('const repFilled = !phoneMode && !!open && open !== "error" && !!open.answers;'),
  );
});

Deno.test("paper page: the button opens the box, and the last box leads on to what is next", () => {
  assert(page.includes("setJump((j) => ({ index: t.index, n: (j?.n ?? 0) + 1 }))"));
  assert(page.includes('setWalk("gaps");'));
  assert(page.includes("onGapsDone={() => (todo.some(isQuestionGap) ? toQuestions() : toSign())}"));
  assert(page.includes('const finished = walk === "gaps" && gaps.length === 0;'));
  // on a wide screen the box itself is focused
  assert(page.includes('querySelector<HTMLElement>(`[data-box="${item.id}"]`)'));
});

Deno.test("paper page: tapping a box yourself still walks every box", () => {
  const tap = page.slice(page.indexOf("<TapBox"), page.indexOf("<InPlaceField"));
  assert(tap.includes('setWalk("all");'));
});

Deno.test("paper page: each box in the phone editor is its own input", () => {
  // one input turning from a text box into a date box while focused (Enter, or the phone
  // keyboard's Next key) took no typing: SSN then date of birth is exactly that step
  const editor = page.slice(page.indexOf("function Editor("));
  assert(/<input\s+\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*key=\{item\.id\}/.test(editor));
});

Deno.test("paper page: the two questions say so when they are what is missing", () => {
  assert(page.includes("{tried && !d.business.bankruptcy && ("));
  assert(page.includes("{tried && !d.real_estate.owns && ("));
  assert(page.includes("ref={questionsRef}"));
});

Deno.test(
  "sign block: the button shows only where a page offers it and something is missing",
  () => {
    assert(signBlock.includes("{onFix && todo.length > 0 && ("));
    assert(signBlock.includes("Fill in what&apos;s missing"));
    // the account page and the step-by-step link page pass no onFix, so they are unchanged
    assert(signBlock.includes("onFix?: () => void;"));
  },
);

Deno.test(
  "paper page: the error under Sign points at the button, not at boxes too small to see",
  () => {
    assert(!page.includes("Fill in the boxes marked in red on the form, then sign."));
    assert(page.includes("Press Fill in what's missing, then sign."));
  },
);

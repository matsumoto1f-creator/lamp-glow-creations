// deno test --node-modules-dir=none tests/field-pace.test.ts
//
// Asad, 2026-11-23: "every time someone like Stevie is on the site his machine starts to lag".
// The dot field behind every page was a full-window WebGL canvas redrawn at the screen's full rate
// at up to twice the screen's pixels, on the staff portal too, whether or not the window was in
// use; and every glass panel re-bent that moving picture each frame. Measured on the home page at
// 1440 by 900: 5.2 million pixels a frame before, 2.0 million after, 0 frames with the window not
// in use, 15 a second while the light drifts, none at all on work screens.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  dueToDraw,
  fieldScale,
  FPS_ACTIVE,
  FPS_IDLE,
  frameGap,
  MAX_DPR,
  MAX_PIXELS,
} from "../src/lib/field-pace.ts";
import field from "../src/components/site/lamp-field.tsx" with { type: "text" };
import layout from "../src/components/site/layout.tsx" with { type: "text" };
import lens from "../src/components/site/lamp-lens.ts" with { type: "text" };
import staff from "../src/routes/staff.tsx" with { type: "text" };

Deno.test("pixels: a retina laptop no longer shades twice the screen", () => {
  const s = fieldScale(1440, 900, 2);
  assert(s <= MAX_DPR);
  assert(1440 * 900 * s * s <= MAX_PIXELS * 1.001);
});

Deno.test("pixels: a very large window stays inside the budget, and never turns to mush", () => {
  const s = fieldScale(3840, 2160, 2);
  assertEquals(s, 0.75);
  assert(fieldScale(2560, 1440, 1) < 1);
  // a phone keeps its sharpness up to the cap
  assertEquals(fieldScale(390, 844, 3), MAX_DPR);
  assertEquals(fieldScale(1280, 720, 1), 1);
});

Deno.test("pace: 30 draws a second while the pointer moves the light, 15 while it drifts", () => {
  assertEquals(FPS_ACTIVE, 30);
  assertEquals(FPS_IDLE, 15);
  assert(frameGap(true) > frameGap(false));
  // on a 60 Hz screen (a frame every 16.7 ms): every second frame when active, every fourth idle
  assert(!dueToDraw(1016.7, 1000, false) && dueToDraw(1033.4, 1000, false));
  assert(!dueToDraw(1050, 1000, true) && dueToDraw(1066.7, 1000, true));
});

Deno.test(
  "field: it draws only when its slot comes up, and not for a window nobody is using",
  () => {
    assert(field.includes("if (!force && !dueToDraw(now, lastDraw, idle)) {"));
    assert(field.includes("if (!force && !still && !document.hasFocus()) return;"));
    assert(field.includes('window.addEventListener("focus", redraw);'));
    assert(
      field.includes(
        "dpr = fieldScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);",
      ),
    );
    assert(!field.includes("Math.min(window.devicePixelRatio || 1, 2)"));
  },
);

Deno.test("field: held still, it draws once and listens for nothing that moves", () => {
  assert(field.includes("export function LampField({ still = false }: { still?: boolean })"));
  assert(field.includes("if (!still && (!reduce || settling || idle)) raf();"));
  const listeners = field.slice(
    field.indexOf("if (!still) {"),
    field.indexOf('window.addEventListener("resize"'),
  );
  assert(listeners.includes('"pointermove"') && listeners.includes('"scroll"'));
  // but it still follows the window and the theme
  assert(field.includes('attributeFilter: ["data-theme"]'));
  assert(field.includes("themeWatch.disconnect();"));
});

Deno.test("work screens: the staff portal, the account and the application are held still", () => {
  assert(layout.includes("const still = live && member;"));
  assert(layout.includes("useLamplightGlass(live && !still);"));
  assert(layout.includes("{live && <LampField still={still} />}"));
  // the staff portal is a member page, so it is one of them
  assert(/<PageShell member wide footer=\{false\} tone="night">/.test(staff));
});

Deno.test("glass: looking for new panels happens once a frame at most", () => {
  const scan = lens.slice(lens.indexOf("mo = new MutationObserver("), lens.indexOf("mo.observe("));
  assert(scan.includes("if (scanning) return;") && scan.includes("requestAnimationFrame("));
  assert(!lens.includes("mo = new MutationObserver(scan);"));
});

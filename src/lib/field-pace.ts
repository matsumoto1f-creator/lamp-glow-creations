// How hard the Lamplight dot field works. It is a full-window WebGL canvas, and it used to redraw
// at the screen's full rate (60 to 120 times a second) at up to twice the screen's pixels, on
// every page including the staff portal, focused or not. On the machines reps use all day that
// alone made the whole computer lag (Asad, 2026-11-23: "every time someone like Stevie is on the
// site his machine starts to lag"). These are the limits it now keeps. No imports, so the tests
// can load it.

/** Frames a second while the pointer is moving the light. */
export const FPS_ACTIVE = 30;
/** Frames a second while the light only drifts on its own: the drift is slow, so this reads as smooth. */
export const FPS_IDLE = 15;
/** The most device pixels the canvas may have, whatever the screen. */
export const MAX_PIXELS = 2_000_000;
/** The canvas never goes past this many device pixels per CSS pixel. */
export const MAX_DPR = 1.5;

/**
 * Device pixels per CSS pixel for the canvas: the screen's own ratio, capped, and lowered again
 * when the window is so large that the cap would still be too many pixels to shade.
 */
export function fieldScale(cssW: number, cssH: number, deviceRatio: number): number {
  const want = Math.min(Math.max(deviceRatio || 1, 1), MAX_DPR);
  const area = Math.max(1, cssW * cssH);
  const budget = Math.sqrt(MAX_PIXELS / area);
  // never below 0.75: under that the dots turn to mush on a very large window
  return Math.max(0.75, Math.min(want, budget));
}

/** Milliseconds that must pass between two draws. */
export const frameGap = (idle: boolean): number => 1000 / (idle ? FPS_IDLE : FPS_ACTIVE);

/** Whether enough time has passed since the last draw (2 ms of slack for timer jitter). */
export const dueToDraw = (now: number, last: number, idle: boolean): boolean =>
  now - last >= frameGap(idle) - 2;

// Saving the signed application's PDF copy onto the file, right after a merchant signs.
// The first application ever signed from a link (2026-11-23, two owners) landed with its answers,
// both signatures and four bank statements, but no signed copy: the page tried once, swallowed
// whatever went wrong, and told nobody. Now it tries again, and what went wrong is written on the
// file's timeline so the next one can be explained. No imports, so the tests can load it.

export const COPY_ALREADY_SAVED = "The signed application is already saved.";

/**
 * Build the PDF and send it; on a failure wait a moment and try once more (the build is kept, so
 * only the sending is repeated when that is what failed). Null when the copy is on the file; else
 * a short reason, for the timeline. Never throws.
 */
export async function saveSignedCopy(
  build: () => Promise<Uint8Array>,
  send: (bytes: Uint8Array) => Promise<string | null>,
  { tries = 2, waitMs = 1500 }: { tries?: number; waitMs?: number } = {},
): Promise<string | null> {
  let bytes: Uint8Array | null = null;
  let why = "";
  for (let n = 0; n < tries; n++) {
    if (n > 0 && waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    try {
      bytes ??= await build();
    } catch (e) {
      why = `the PDF could not be built (${message(e)})`;
      continue;
    }
    try {
      const err = await send(bytes);
      // "already saved" is the first try having landed after all
      if (!err || err === COPY_ALREADY_SAVED) return null;
      why = `the upload was refused (${err})`;
    } catch (e) {
      why = `the upload did not go through (${message(e)})`;
    }
  }
  return why || "unknown";
}

const message = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 120) || "no message";

/** What the file's timeline says when the copy did not save. */
export const copyMissingNote = (why: string) =>
  `The signed PDF copy did not save from the merchant's browser: ${why.slice(0, 200)}. ` +
  "The answers and signatures are on this file; use the application's Download to make the PDF.";

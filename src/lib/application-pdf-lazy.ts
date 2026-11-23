// The PDF builder (pdf-lib, fontkit and the form's own code) is over a megabyte of script. Every
// page that can make a PDF used to load all of it before showing anything: the application a
// merchant opens on a phone, the staff portal, the account page. These load it only when a PDF is
// actually made, and warm() fetches it quietly once the page is idle so signing never waits on it.
import type { ApplicationSource, ApplicationValues, PdfPages } from "@/lib/application-pdf";

const load = () => import("@/lib/application-pdf");

/** Fetches the template and builds the PDF's bytes. Browser only. */
export async function applicationPdfBytes(
  src: ApplicationSource,
  full?: ApplicationValues,
  pages?: PdfPages,
): Promise<Uint8Array> {
  return (await load()).applicationPdfBytes(src, full, pages);
}

/** Fetches the template, builds the PDF and starts the download. Browser only. */
export async function downloadApplicationPdf(
  src: ApplicationSource,
  full?: ApplicationValues,
  pages?: PdfPages,
  suffix?: string,
): Promise<void> {
  return (await load()).downloadApplicationPdf(src, full, pages, suffix);
}

/**
 * Fetch the builder ahead of time, once the browser has nothing better to do. Safe to call more
 * than once; a failure is ignored (the real call will try again and report it).
 */
export function warmApplicationPdf(): void {
  if (typeof window === "undefined") return;
  const go = () => void load().catch(() => undefined);
  const idle = (
    window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }
  ).requestIdleCallback;
  if (idle) idle(go, { timeout: 4000 });
  else window.setTimeout(go, 2500);
}

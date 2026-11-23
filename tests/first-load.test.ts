// deno test --node-modules-dir=none tests/first-load.test.ts
//
// 2026-11-23, first-load speed. The PDF builder (pdf-lib, fontkit and the form's code: 1.1 MB of
// script, about 500 KB compressed) was loaded up front by every page that can make a PDF: the
// application a merchant opens on a phone, the staff portal and the account page. The pages only
// needed to know where the boxes sit on the form. Now the box positions are their own small file
// and the builder is fetched when a PDF is made (warmed in the background on the application).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { CHECKBOXES, TEXT_FIELDS } from "../src/lib/application-boxes.ts";
import boxes from "../src/lib/application-boxes.ts" with { type: "text" };
import lazy from "../src/lib/application-pdf-lazy.ts" with { type: "text" };
import pdf from "../src/lib/application-pdf.ts" with { type: "text" };
import paperForm from "../src/lib/paper-form.ts" with { type: "text" };
import root from "../src/routes/__root.tsx" with { type: "text" };

import paperPage from "../src/components/application/paper-application.tsx" with { type: "text" };
import stepsPage from "../src/components/application/link-application.tsx" with { type: "text" };
import accountPage from "../src/components/site/complete-application.tsx" with { type: "text" };
import fileSend from "../src/components/staff/file-send.tsx" with { type: "text" };
import fileView from "../src/components/staff/file-view.tsx" with { type: "text" };

const PAGES: [string, string][] = [
  ["one-page application", paperPage],
  ["step-by-step application", stepsPage],
  ["account page", accountPage],
  ["staff: send to funder", fileSend],
  ["staff: file view", fileView],
];

Deno.test("boxes: the positions stand alone, with nothing to load", () => {
  assert(!/^import /m.test(boxes));
  assertEquals(TEXT_FIELDS["legal_name"], [45, 121.5, 305, 132]);
  assert(Object.keys(TEXT_FIELDS).length > 50 && Object.keys(CHECKBOXES).length === 13);
  // one table, not two: the builder uses these same boxes
  assert(
    pdf.includes('import { CHECKBOXES, TEXT_FIELDS, type Box } from "@/lib/application-boxes";'),
  );
  assert(!pdf.includes("export const TEXT_FIELDS"));
});

Deno.test("pages: none loads the PDF builder up front", () => {
  for (const [name, src] of [...PAGES, ["paper form rules", paperForm] as [string, string]]) {
    const eager = [...src.matchAll(/^import (?!type )[^;]*from "@\/lib\/application-pdf";/gm)];
    assertEquals(eager.length, 0, `${name} still loads the builder with the page`);
  }
  assert(paperForm.includes('from "@/lib/application-boxes";'));
});

Deno.test("builder: fetched when a PDF is made, and only its types are known before", () => {
  assert(lazy.includes('const load = () => import("@/lib/application-pdf");'));
  assert(/^import type \{[^}]*\} from "@\/lib\/application-pdf";/m.test(lazy));
  assert(!/^import \{/m.test(lazy));
  assert(lazy.includes("(await load()).applicationPdfBytes(src, full, pages)"));
  assert(lazy.includes("(await load()).downloadApplicationPdf(src, full, pages, suffix)"));
});

Deno.test(
  "application pages: the builder is warmed in the background so signing never waits",
  () => {
    for (const [name, src] of PAGES.slice(0, 2))
      assert(src.includes("useEffect(() => warmApplicationPdf(), []);"), name);
    assert(lazy.includes("requestIdleCallback") && lazy.includes(".catch(() => undefined)"));
  },
);

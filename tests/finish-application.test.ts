// deno test --node-modules-dir=none tests/finish-application.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { finishEmail } from "../src/lib/application-links.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import fileView from "../src/components/staff/file-view.tsx" with { type: "text" };
import quick from "../src/components/staff/quick-only.tsx" with { type: "text" };
import hook from "../src/lib/full-application.ts" with { type: "text" };

const base = {
  firstName: "Thomas",
  businessName: "Sample Counseling LLC",
  repName: "Zeus",
  site: "https://getlamp.app/",
  legalName: "Lamp Capital Group LLC",
  address: "206 E Broad St, Westfield, NJ 07090",
};

Deno.test("finish email: points to their own account, so it lands on the same file", () => {
  const m = finishEmail(base);
  assertEquals(m.subject, "Finish your Lamp application for Sample Counseling LLC");
  assert(m.text.startsWith("Hi Thomas,"));
  assert(m.text.includes("Finish my application: https://getlamp.app/account"));
  assert(m.html.includes('href="https://getlamp.app/account"'));
  assert(m.text.includes("Start my application"));
  assert(m.text.includes("no password needed"));
  // no application link, so no second file; no quick form; never "loan"
  assert(!m.text.includes("/application/") && !m.text.includes("/apply/"));
  for (const part of [m.subject, m.text, m.html]) assert(!/\bloans?\b/i.test(part));
  // why they got it, and how to stop it
  assert(m.text.includes("you checked your options on getlamp.app"));
  assert(m.text.includes('Reply "stop"'));
  assert(m.text.includes("206 E Broad St"));
  assertEquals(
    finishEmail({ ...base, firstName: " ", businessName: "" }).subject,
    "Finish your Lamp application",
  );
});

Deno.test("server: who may send it, and when it's refused", () => {
  const fn = server.slice(server.indexOf("export async function finishApplicationNudge"));
  const work = fn.indexOf("mayWork(who, appId)");
  const send = fn.indexOf("gmailSend(");
  assert(work > 0 && send > work, "the work check comes before any email");
  for (const guard of [
    'if (details.data) return json(409, { error: "This file already has the full application." });',
    "if (!app.user_id)",
    'if ((recent.data ?? []).length) return json(429, { error: "Already sent in the last day." });',
    'if (dnc) return json(409, { error: "Marked do not contact." });',
  ])
    assert(fn.indexOf(guard) > 0 && fn.indexOf(guard) < send, `missing or late: ${guard}`);
  assert(fn.includes('kind: "email"') && fn.includes("Asked to finish the full application"));
});

Deno.test(
  "file page: says plainly when only the quick answers exist, and a failed check doesn't",
  () => {
    assert(fileView.includes('? "Quick answers PDF"'));
    assert(fileView.includes("{full === null && ("));
    assert(fileView.includes("canSend={!watching(isAdmin, repSlug, file.rep_slug)}"));
    assert(quick.includes("Nothing is hidden: it hasn&apos;t been given yet."));
    // an error is undefined (unknown), never null ("not filled in")
    assert(hook.includes("r.ok ? toFull(r.data.details ?? null) : undefined"));
    assert(!hook.includes("next = null;"));
  },
);

// deno test --node-modules-dir=none tests/finish-application.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { finishEmail } from "../src/lib/application-links.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import fileView from "../src/components/staff/file-view.tsx" with { type: "text" };
import migration from "../supabase/migrations/20261123180000_finish_on_the_file.sql" with { type: "text" };
import paperForm from "../src/lib/paper-form.ts" with { type: "text" };
import sections from "../src/components/application/sections.tsx" with { type: "text" };
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
    // no account is fine once the file's own application link can be made; refused only when
    // neither that link nor an account exists
    "if (!link && !app.user_id)",
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

Deno.test("finish email: sends the file's own application, filled in from the file", () => {
  const fn = server.slice(
    server.indexOf("export async function finishApplicationNudge"),
    server.indexOf("async function fileApplicationLink("),
  );
  assert(
    fn.includes(
      "const link = rep ? await fileApplicationLink(svc, rep, app, to, who.userId) : null;",
    ),
  );
  // the application email when the link can be made, the account email only as the fallback
  assert(/const mail = link\s*\? inviteEmail\(/.test(fn) && fn.includes(": finishEmail({"));
  const make = server.slice(server.indexOf("async function fileApplicationLink("));
  // a link already made from this file goes out again; no second one
  assert(make.indexOf('.eq("file_id" as never, app.id)') < make.indexOf(".insert("));
  assert(make.includes("const url = await sameLink(svc, rep.slug, had);"));
  // a new one opens with what the file knows, and is tied to the file
  assert(
    make.includes("prefill({") &&
      make.includes("file_id: app.id,") &&
      make.includes("draft_saved_at: now,"),
  );
  // before the database step is run the column lookup fails, and the old email goes out
  assert(make.includes("if (open.error) return null;"));
});

Deno.test("database: a link made from a file signs onto that file, never a second one", () => {
  assert(
    migration.includes("add column if not exists file_id uuid references public.applications (id)"),
  );
  const fn = migration.slice(
    migration.indexOf("create or replace function public.submit_link_application("),
  );
  const onto = fn.indexOf("if inv.file_id is not null then");
  const insert = fn.indexOf("insert into public.applications (");
  assert(onto > 0 && insert > onto, "the file is looked for before a new file is made");
  assert(fn.slice(onto, insert).includes("app_id := target.id;"));
  assert(fn.slice(onto, insert).includes("update public.applications"));
  // a signed file refuses; an unsigned draft gives way
  assert(
    fn.includes(
      "where application_id = target.id and signed_at is not null) then\n      raise exception 'already_signed'",
    ),
  );
  assert(
    fn.includes(
      "delete from public.application_details where application_id = target.id and signed_at is null;",
    ),
  );
  // the file's account sees it, and the rep is told
  assert(
    fn.includes(
      "update public.application_details set user_id = target.user_id where application_id = app_id;",
    ),
  );
  assert(fn.includes("perform public.notify_rep_and_lead("));
  // the rest is the function as it was: the limits and link checks are still there
  for (const kept of [
    "raise exception 'too_many'",
    "raise exception 'link_cancelled'",
    "raise exception 'link_expired'",
    "perform set_config('lamp.link_signing', 'on', true);",
  ])
    assert(fn.includes(kept), kept);
});

Deno.test(
  "uploads: a file signed from its own link takes statements though it has an account",
  () => {
    const up = server.slice(
      server.indexOf("export async function uploadToApplication("),
      server.indexOf("export async function notifyNewApplication("),
    );
    assert(up.includes('.eq("file_id" as never, a.id)'));
    assert(up.includes("if (a.user_id && !viaFile)"));
    assert(up.includes("if (!viaFile && Date.now() - Date.parse(a.created_at) > 48 * 3_600_000)"));
  },
);

Deno.test("paper form: the SSN and tax ID boxes take nine digits and no more", () => {
  assert(paperForm.includes('set: (d, v) => own(i, "ssn")(d, digits(v).slice(0, 9)),'));
  assert(paperForm.includes('set: (d, v) => biz("ein")(d, digits(v).slice(0, 9)),'));
  assert(sections.includes('const x = raw.replace(/\\D/g, "").slice(0, 9);'));
});

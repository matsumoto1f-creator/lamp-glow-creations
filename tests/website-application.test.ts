// deno test --node-modules-dir=none tests/website-application.test.ts
// The website's own full application (getlamp.app/application, Asad 2026-11-19): quick questions,
// contact (saved as a lead with no rep), a rough range, then the full application; the signed
// file lands unassigned and says it came from the website. /apply and /apply/<rep> send people on.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  APPLICATION_PARTS,
  carriedSearch,
  funnelLabel,
  funnelStep,
  QUESTIONS,
  quickFromParams,
} from "../src/lib/apply.ts";
import { startedEmail } from "../src/lib/new-application-email.ts";
import original from "../supabase/migrations/20261027120000_application_links.sql" with { type: "text" };
import migration from "../supabase/migrations/20261119200000_website_application.sql" with { type: "text" };
import applyRoute from "../src/routes/apply.tsx" with { type: "text" };
import applyRepRoute from "../src/routes/apply_.$rep.tsx" with { type: "text" };
import websiteRoute from "../src/routes/application.index.tsx" with { type: "text" };
import repRoute from "../src/routes/application.$rep.tsx" with { type: "text" };
import page from "../src/components/application/link-application.tsx" with { type: "text" };
import links from "../src/lib/application-links.server.ts" with { type: "text" };
import start from "../src/lib/application-start.server.ts" with { type: "text" };
import cameIn from "../src/components/staff/came-in.tsx" with { type: "text" };
import started from "../src/components/staff/started-leads.tsx" with { type: "text" };
import dashboard from "../src/components/staff/dashboard.tsx" with { type: "text" };
import sitemap from "../public/sitemap.xml" with { type: "text" };

const FN = "create or replace function public.submit_link_application(";
const fnOf = (sql: string, end: string) =>
  sql.slice(sql.indexOf(FN), sql.indexOf(end, sql.indexOf(FN)));

Deno.test("drop-off: every screen of a public application is the next numbered step", () => {
  const seen: { step: number; question: string }[] = [];
  for (let i = 0; i < QUESTIONS.length; i++)
    seen.push(
      funnelStep({ quickStep: i, contactDone: false, showRange: false, part: 0, signed: false }),
    );
  seen.push(
    funnelStep({
      quickStep: QUESTIONS.length,
      contactDone: false,
      showRange: false,
      part: 0,
      signed: false,
    }),
  );
  seen.push(
    funnelStep({
      quickStep: QUESTIONS.length,
      contactDone: true,
      showRange: true,
      part: 0,
      signed: false,
    }),
  );
  for (let p = 0; p < APPLICATION_PARTS.length; p++)
    seen.push(
      funnelStep({
        quickStep: QUESTIONS.length,
        contactDone: true,
        showRange: false,
        part: p,
        signed: false,
      }),
    );
  seen.push(
    funnelStep({
      quickStep: QUESTIONS.length,
      contactDone: true,
      showRange: false,
      part: 5,
      signed: true,
    }),
  );
  assertEquals(
    seen.map((s) => s.step),
    seen.map((_, i) => i),
  );
  assertEquals(seen[QUESTIONS.length]!.question, "contact");
  assertEquals(seen[QUESTIONS.length + 1]!.question, "result");
  assertEquals(seen.at(-1)!.question, "signed");
  // the dashboard names each one in words, never the raw key
  for (const s of seen) assert(!/^app_|^step /.test(funnelLabel(s.question)), s.question);
  assertEquals(funnelLabel("app_statements"), "Application: statements");
  assertEquals(funnelLabel("result"), "Saw their options");
  assertEquals(funnelLabel(QUESTIONS[0]!.key), QUESTIONS[0]!.title);
  // a step past the end of the application is the last part, never undefined
  assertEquals(
    funnelStep({ quickStep: 99, contactDone: true, showRange: false, part: 40, signed: false })
      .question,
    "app_sign",
  );
  assert(dashboard.includes("funnelLabel(s.question)"));
});

Deno.test("links keep their quick answers and utm tags; nothing personal rides in the URL", () => {
  const params = {
    amount: QUESTIONS.find((q) => q.key === "amount")!.options[1]!.id,
    industry: "not-a-real-option",
    utm_source: "google",
    utm_campaign: "trucking",
    ref: "zeus",
    email: "someone@example.test",
    phone: "2015550100",
    name: "Thomas",
  };
  const quick = quickFromParams(params);
  assertEquals(quick, { amount: params.amount });
  assertEquals(carriedSearch(params), {
    amount: params.amount,
    utm_source: "google",
    utm_campaign: "trucking",
  });
});

Deno.test("routes: /apply and /apply/<rep> send people on to the full application", () => {
  assert(applyRoute.includes('throw redirect({ to: "/application", search: carriedSearch(search)'));
  assert(!applyRoute.includes("ApplyFlow"));
  assert(applyRepRoute.includes('to: "/application/$rep"'));
  assert(applyRepRoute.includes("params.rep.toLowerCase()"));
  assert(!applyRepRoute.includes("ApplyFlow"));
  // the website's own page has no rep and no personal link
  assert(websiteRoute.includes('createFileRoute("/application/")'));
  assert(websiteRoute.includes('<LinkApplication repSlug="" token={null}'));
  // a rep's public link takes the same quick answers; a personal link never does
  assert(repRoute.includes("prefill={i ? {} : quickFromParams(search)}"));
  assert(sitemap.includes("https://getlamp.app/application<"));
  assert(!sitemap.includes("https://getlamp.app/apply<"));
});

Deno.test("page: website mode says Lamp, shows the range, then the application", () => {
  assert(page.includes('const website = !token && repSlug === "";'));
  assert(page.includes('rep?.name ?? (website ? "the Lamp team" : "your Lamp rep")'));
  assert(page.includes("if (!token && estimate(quick)) setShowRange(true);"));
  assert(page.includes("Finish my application · about 10 minutes"));
  assert(page.includes('website ? "The Lamp team" : repName'));
  // the done screen never reads "your has it" when there is no rep
  assert(page.includes('done.rep_name ? (done.rep_name.split(" ")[0] ?? done.rep_name) : "Lamp"'));
  // a range is never an approval or an offer, and the product is never called a loan
  assert(page.includes("not an offer"));
  const shown = page.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  assert(!shown.some((l) => /\bloans?\b/i.test(l)));
});

Deno.test(
  "server: the website opens and signs with no rep; a rep link still needs a real rep",
  () => {
    // (whitespace-insensitive, so formatting can't break it)
    const flat = links.replace(/\s+/g, " ");
    assert(
      flat.includes(
        'if (slug === "") return json(200, { state: "open", draft: null, rep: null, prefill: null,',
      ),
    );
    assert(links.includes('if (token === null && rep !== "" && !SLUG.test(rep))'));
    assert(links.includes('"the website\'s application"'));
    assert(start.includes('const website = rep === "";'));
    assert(start.includes("if (!website && !SLUG.test(rep)) return json(400"));
    assert(start.includes('website ? { utm_source: "website" } : { ref: rep }'));
    // a website lead is never handed to a rep through ref
    assert(!/website \? \{[^}]*ref:/.test(start));
  },
);

Deno.test("heads-up email for a website lead says the website, not 'your link'", () => {
  const m = startedEmail({
    repName: null,
    first: "Thomas",
    last: "Reed",
    phone: "(201) 555-0100",
    email: "t@example.test",
    textsOk: true,
  });
  assertEquals(m.subject, "Started: Thomas Reed opened the application on the website");
  assert(m.text.startsWith("Hi,"));
  assert(m.text.includes("on the website (getlamp.app). No rep has them yet."));
  assert(!m.text.includes("your link"));
  const r = startedEmail({
    repName: "Zeus Diaz",
    first: "A",
    last: "B",
    phone: "1",
    email: "e",
    textsOk: false,
  });
  assert(r.subject.endsWith("on Zeus Diaz's link"));
  assert(r.text.includes("on your link"));
});

Deno.test("migration: the same signing function plus only the website case", () => {
  const before = fnOf(original, "-- ---------- 6.");
  const after = fnOf(migration, "-- read-only check");
  // every line of today's function is still there, except the four the website case rewrites
  const kept = new Set(after.split("\n"));
  const rewritten = [
    "  select name into rep_name from public.reps where slug = rep;",
    "    null, rep, rep, now(), '{}'::jsonb,",
    "    jsonb_build_object('ref', rep, 'source', 'application_link')",
    "  else",
  ];
  const lost = before.split("\n").filter((l) => !kept.has(l) && !rewritten.includes(l));
  assertEquals(lost, []);
  // the website: no rep, its own hourly cap, unassigned, says where it came from
  assert(after.includes("elsif coalesce(trim(_rep_slug), '') = '' then"));
  assert(after.includes("if recent >= 30 then"));
  assert(after.includes("case when rep is null then null else now() end"));
  assert(after.includes("jsonb_build_object('source', 'website_application')"));
  assert(after.includes("Submitted from the website''s application (getlamp.app)"));
  // a rep's public link keeps its cap of 20 and its unknown_rep refusal
  assert(after.includes("raise exception 'unknown_rep'"));
  assert(after.includes("if recent >= 20 then"));
  // still callable only the way it was
  assert(migration.includes("revoke all on function public.submit_link_application("));
  assert(migration.includes("grant execute on function public.submit_link_application("));
  assert(migration.includes("create index if not exists applications_website_link_idx"));
});

Deno.test("staff see where a website file or lead came from", () => {
  assert(cameIn.includes('utm["source"] === "website_application"'));
  assert(cameIn.includes("The website's application (getlamp.app/application)"));
  assert(started.includes(': "Website"'));
});

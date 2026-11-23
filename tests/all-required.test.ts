// deno test --node-modules-dir=none tests/all-required.test.ts
//
// Asad, 2026-11-23: "We need everything that's on that application, that's on the PDF ... The only
// thing that's optional is like property. Everything else, mandatory ... Co-owners, that's
// optional." Every box on the paper application is now asked for before signing, on both forms and
// again on the server (which uses the same list). Where a box can't apply there is an answer that
// says so.
import { assert } from "jsr:@std/assert@1";
import details from "../src/lib/application-details.ts" with { type: "text" };
import paperForm from "../src/lib/paper-form.ts" with { type: "text" };
import sections from "../src/components/application/sections.tsx" with { type: "text" };
import page from "../src/components/application/paper-application.tsx" with { type: "text" };
import steps from "../src/components/application/link-application.tsx" with { type: "text" };
import progress from "../src/lib/application-progress.ts" with { type: "text" };
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import { isQuestionGap } from "../src/lib/paper-gaps.ts";

const rules = details.slice(
  details.indexOf("export function missing("),
  details.indexOf("export function signatureMatches("),
);

Deno.test("required: every business box on the paper application is asked for", () => {
  for (const what of [
    '"business email"',
    '"industry"',
    '"monthly card sales (0 if none)"',
    '"business bank"',
    '"deposits a month"',
    '"whether you own or rent the business location"',
    '"whether there are liens or judgments"',
    '"preferred term"',
    '"what the funding is for"',
  ])
    assert(rules.includes(what), `not asked for: ${what}`);
});

Deno.test(
  "required: the owner's title and credit guess, for a second owner too once there is one",
  () => {
    assert(rules.includes("need(!!o.title.trim(), `${who}'s title`);"));
    assert(rules.includes("need(!!o.credit.trim(), `${who}'s credit score (best guess)`);"));
    // inside the loop over owners, so a second owner who is listed is asked the same
    assert(rules.indexOf("d.owners.forEach(") < rules.indexOf("`${who}'s title`"));
  },
);

Deno.test("required: a box that can't apply has an answer that says so", () => {
  // rent only of a business that rents
  assert(rules.includes('if (b.premises === "rent") need(!!b.rent.trim(), "monthly rent");'));
  // current funding only when they say they have some; No is a full answer
  assert(
    rules.includes('need(!!funded, "whether you have business funding with a balance today");'),
  );
  assert(rules.includes('if (funded === "yes")'));
  assert(sections.includes("Enter 0 if you don't take cards."));
});

Deno.test("required: property details and a second owner stay optional", () => {
  // the paper form still asks only whether they own real estate
  assert(
    rules.includes('else if (!d.real_estate.owns) out.push("whether you own any real estate");'),
  );
  // nothing asks for a second owner to exist
  assert(!/second owner['"`]?\s*\)/.test(rules) && !rules.includes("owners.length"));
  assert(
    paperForm.includes("const needed = (d: Details) => i === 0 || (!!o(d) && !ownerBlank(o(d)!));"),
  );
});

Deno.test(
  "required: an application from before the funding question still counts its funding rows",
  () => {
    assert(details.includes('d.request.funded || (d.balances.some(balanceStarted) ? "yes" : "");'));
  },
);

Deno.test("required: the server refuses a signed application with any of these missing", () => {
  assert(server.includes("const todo = missing(d, { propertyDetails: !paper });"));
  assert(
    server.includes(
      'if (todo.length) return json(422, { error: "Some answers are missing.", missing: todo });',
    ),
  );
});

Deno.test("online form: nothing that is required still says optional", () => {
  for (const label of [
    "Business email",
    "Monthly card sales",
    "Business bank",
    "Deposits a month",
    "Title",
  ])
    assert(
      !new RegExp(`<F label="${label}"[^>]*\\boptional\\b`).test(sections),
      `${label} still says optional`,
    );
  // the boxes that really are optional keep saying so
  assert(sections.includes('<F label="Doing business as" optional>'));
  assert(sections.includes('<F label="Website" optional>'));
});

Deno.test(
  "online form: asks whether there is funding with a balance, and No clears the rows",
  () => {
    assert(sections.includes("Do you have any business funding with a balance today?"));
    const rows = sections.slice(
      sections.indexOf("Do you have any business funding with a balance today?"),
    );
    assert(/fundedAnswer\(d\) === "yes" &&\s+d\.balances\.map\(\(b, i\) => \(/.test(rows));
    assert(rows.includes(': v === "no"') && rows.includes("? []"));
  },
);

Deno.test("online form: the new funding answers are asked for on the funding step", () => {
  assert(steps.includes("(FUNDING_GAPS as readonly string[]).includes(m)) out.funding.push(m);"));
  assert(progress.includes("(FUNDING_GAPS as readonly string[]).includes(m)"));
  for (const g of [
    "preferred term",
    "what the funding is for",
    "whether you have business funding with a balance today",
    "current funding: the company and the balance now",
  ])
    assert(
      details
        .slice(
          details.indexOf("export const FUNDING_GAPS"),
          details.indexOf("] as const;", details.indexOf("export const FUNDING_GAPS")),
        )
        .includes(`"${g}"`),
      g,
    );
});

Deno.test("paper form: every newly required box and tick box has a rule that marks it", () => {
  for (const rule of [
    ".test(d.business.email.trim()),",
    "ok: (d) => !!d.business.card_volume.trim(),",
    "ok: (d) => !!d.business.industry.trim(),",
    "ok: (d) => d.request.uses.length > 0,",
    "ok: (d) => !!d.business.bank.trim(),",
    "ok: (d) => !!d.business.deposit_count.trim(),",
    "ok: (d) => !!d.business.premises,",
    'ok: (d) => d.business.premises !== "rent" || !!d.business.rent.trim(),',
    "ok: (d) => !!d.business.liens,",
    "ok: (d) => !!d.request.term,",
    "ok: (d) => !needed(d) || !!o(d)?.title.trim(),",
    "ok: (d) => !needed(d) || !!o(d)?.credit.trim(),",
  ])
    assert(paperForm.includes(rule), `no rule: ${rule}`);
  // the first current-funding row, once they say they have funding
  assert(
    paperForm.includes(
      'fundedAnswer(d) === "yes" && !d.balances.some((x) => !!x.funder.trim() && !!x.current.trim())',
    ),
  );
});

Deno.test("paper form: tick boxes are marked and walked like the other boxes", () => {
  assert(paperForm.includes("PAPER_ITEMS.filter((x) => !!x.ok && !x.ok(d)).map((x) => x.id)"));
  assert(page.includes("wrong={wrong.has(item.id)}"));
  assert(!page.includes('wrong={item.kind === "field" && wrong.has(item.id)}'));
});

Deno.test("paper page: the funding question sits with the other two under the form", () => {
  assert(page.includes("Three more questions"));
  assert(page.includes("Do you have any business funding with a balance today?"));
  assert(page.includes("{tried && !fundedAnswer(d) && ("));
  assert(isQuestionGap("whether you have business funding with a balance today"));
});

// deno test --node-modules-dir=none tests/email-kinds.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  EMAIL_KIND_LABEL,
  EMAIL_KINDS,
  emailWords,
  inviteEmail,
  inviteSms,
  isEmailKind,
  kindLinks,
  LINK_TTL_DAYS,
  linkDays,
} from "../src/lib/application-links.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import panel from "../src/components/staff/send-applications.tsx" with { type: "text" };
import migration from "../supabase/migrations/20261119150000_invite_email_kind.sql" with { type: "text" };

const URL_ = "https://getlamp.app/application/zeus?i=TOKEN123";
const base = {
  firstName: "Dana",
  businessName: "Vella Interiors, Inc.",
  repName: "Zeus Sample",
  note: "",
  url: URL_,
  legalName: "Lamp Capital Group LLC",
  address: "206 E Broad St, Westfield, NJ 07090",
};

Deno.test("every kind: never 'loan', always the personal link, the opt-out and the address", () => {
  for (const kind of EMAIL_KINDS) {
    const m = inviteEmail({ ...base, kind });
    for (const part of [m.subject, m.text, m.html])
      assert(!/\bloans?\b/i.test(part), `${kind} says loan`);
    assert(m.text.includes(URL_), `${kind}: plain text lacks the personal link`);
    assert(m.html.includes(URL_), `${kind}: html lacks the personal link`);
    assert(m.text.includes('Reply "stop"'), `${kind}: no opt-out`);
    assert(m.text.includes("206 E Broad St"), `${kind}: no postal address`);
    assert(m.text.startsWith("Hi Dana,"));
    assert(m.subject.length <= 80);
    // a picker label and a hint for every kind
    assert(EMAIL_KIND_LABEL[kind].label && EMAIL_KIND_LABEL[kind].when);
  }
});

Deno.test("each kind's button goes where its words say", () => {
  const l = kindLinks(URL_);
  assertEquals(l, {
    site: "https://getlamp.app",
    howItWorks: "https://getlamp.app/how-it-works",
    offerCheck: "https://getlamp.app/offer-check",
  });
  const button = (kind: (typeof EMAIL_KINDS)[number]) =>
    emailWords(kind, { businessName: "", url: URL_ }).button.url;
  assertEquals(button("apply"), URL_);
  assertEquals(button("later"), l.howItWorks);
  // every link a rep sends is the full application (Asad, 2026-11-19), never the quick questions
  assertEquals(button("options"), URL_);
  assertEquals(button("offer"), l.offerCheck);
  // the softer kinds still name the application, under the button
  for (const k of ["later", "offer"] as const) {
    const m = inviteEmail({ ...base, kind: k });
    assert(m.html.includes(`href="${URL_}"`), `${k}: application link missing from the html`);
    assert(m.html.includes(`href="${button(k)}"`), `${k}: button link missing`);
  }
});

Deno.test("the words match the call: 'later' never says 'as we discussed'", () => {
  const later = inviteEmail({ ...base, kind: "later" });
  assertEquals(later.subject, "Thanks for taking my call");
  assert(!later.text.includes("as we discussed"));
  assert(!later.subject.toLowerCase().includes("application"));
  assert(
    later.text.includes(
      "working capital, equipment financing, invoice factoring, SBA and term funding",
    ),
  );
  const options = inviteEmail({ ...base, kind: "options" });
  assert(options.text.includes("side by side"));
  assert(!options.text.includes("/apply/"), "no quick-form link in a rep's email");
  assert(
    !/credit/i.test(options.text),
    "the full application authorises a credit check: no credit claim",
  );
  const offer = inviteEmail({ ...base, kind: "offer" });
  assert(offer.text.includes("compare up to three offers side by side"));
  assert(offer.text.includes("never obligated to take any offer"));
  const apply = inviteEmail({ ...base });
  assertEquals(apply.subject, "Your Lamp application for Vella Interiors, Inc.");
  assert(
    apply.text.includes(
      "Here's your funding application for Vella Interiors, Inc., as we discussed.",
    ),
  );
});

Deno.test("a personal note replaces the first line, whichever kind", () => {
  for (const kind of EMAIL_KINDS) {
    const opener = emailWords(kind, { businessName: base.businessName, url: URL_ }).opener;
    const m = inviteEmail({ ...base, kind, note: "Good chatting about the new truck." });
    assert(m.text.includes("Good chatting about the new truck."));
    assert(!m.text.includes(opener), `${kind}: kept the default first line under a note`);
  }
});

Deno.test("text messages follow the kind, and HTML in a name is escaped", () => {
  assert(inviteSms("Dana", "Zeus", URL_).includes(URL_));
  assert(inviteSms("Dana", "Zeus", URL_, "later").includes("No rush"));
  assert(inviteSms("Dana", "Zeus", URL_, "options").includes(URL_));
  for (const kind of EMAIL_KINDS)
    assert(!inviteSms("Dana", "Zeus", URL_, kind).includes("/apply/"));
  assert(inviteSms("Dana", "Zeus", URL_, "offer").includes("https://getlamp.app/offer-check"));
  for (const kind of EMAIL_KINDS)
    assert(!/\bloans?\b/i.test(inviteSms("Dana", "Zeus", URL_, kind)));
  const m = inviteEmail({ ...base, firstName: "<b>Dana</b>", kind: "later" });
  assert(!m.html.includes("<b>Dana</b>") && m.html.includes("&lt;b&gt;Dana&lt;/b&gt;"));
});

Deno.test("kinds and link lifetimes", () => {
  assert(isEmailKind("later") && !isEmailKind("loan") && !isEmailKind(undefined));
  assertEquals(linkDays("apply"), LINK_TTL_DAYS);
  // "whenever you're ready" links stay open longer
  for (const k of ["later", "options", "offer"] as const) assertEquals(linkDays(k), 90);
});

Deno.test(
  "server: an unknown kind is refused, a resend keeps the first kind, old databases still send",
  () => {
    assert(server.includes('return json(400, { error: "Unknown kind of email." })'));
    assert(server.includes("const kind = await storedKind(svc, inv.id);"));
    assert(server.includes("expires_at: days(linkDays(kind))"));
    // before the column exists, the insert is retried without it rather than failing the send
    assert(server.includes("noKindColumn(ins.error)"));
    assert(migration.includes("add column if not exists email_kind text"));
    assert(migration.includes("('apply', 'later', 'options', 'offer')"));
  },
);

Deno.test("an admin sends in their own name, never their team lead's", () => {
  // server: the lead's name is used only for a sender who is not an admin
  assert(server.includes("if (rep.admin_slug && !isAdmin) {"));
  assert(/\.eq\("role", "admin"\)/.test(server.slice(server.indexOf("async function repBySlug"))));
  // the panel's preview follows the same rule for an admin sending as themselves
  assert(panel.includes("!(isAdmin && sender === repSlug)"));
});

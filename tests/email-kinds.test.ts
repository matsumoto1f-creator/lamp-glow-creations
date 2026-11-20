// deno test --node-modules-dir=none tests/email-kinds.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildAltMime,
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
import thanksSql from "../supabase/migrations/20261120150000_invite_email_kind_thanks.sql" with { type: "text" };
import leads from "../src/components/staff/engine-leads.tsx" with { type: "text" };

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

Deno.test("'thanks' is a thank-you that says what Lamp is and asks for nothing", () => {
  const m = inviteEmail({ ...base, kind: "thanks" });
  assertEquals(m.subject, "Thanks for your time today");
  assert(m.text.includes("Thanks for giving me a few minutes today."));
  // Asad, 2026-11-20: a business financing brokerage with private financing and standard commercial products
  assert(
    m.text.includes(
      "Lamp is a business financing brokerage. We work with private funders and standard commercial programs",
    ),
  );
  assert(
    m.text.includes(
      "working capital, lines of credit, equipment financing, invoice factoring, SBA and term funding",
    ),
  );
  assert(
    m.text.includes("If financing ever comes up at Vella Interiors, Inc., reply to this email"),
  );
  // not an application email: nothing "as we discussed", no ask to fill anything in, no credit claim
  assert(!m.text.includes("as we discussed") && !m.subject.toLowerCase().includes("application"));
  assert(!/ten minutes|sign|statements|credit check|your credit/i.test(m.text));
  // the button is how Lamp works; the personal application link sits under it, for later
  assertEquals(
    emailWords("thanks", { businessName: "", url: URL_ }).button.url,
    "https://getlamp.app/how-it-works",
  );
  assert(m.html.includes(`href="${URL_}"`) && m.text.includes(URL_));
  // with no business name the sentence still reads
  assert(
    inviteEmail({ ...base, businessName: "", kind: "thanks" }).text.includes(
      "If financing ever comes up, reply to this email",
    ),
  );
  const sms = inviteSms("Dana", "Zeus", URL_, "thanks");
  assert(
    sms.includes("Thanks for your time today") && sms.includes("business financing brokerage"),
  );
  assert(sms.includes("https://getlamp.app/how-it-works") && sms.includes(URL_));
});

Deno.test(
  "a lead's own page offers every kind, and the email opens there on the kind picked",
  () => {
    assertEquals([...EMAIL_KINDS], ["apply", "thanks", "later", "options", "offer"]);
    for (const k of EMAIL_KINDS) {
      const short = EMAIL_KIND_LABEL[k].short;
      assert(short && short.length <= 22, `${k}: the button on the lead needs a short label`);
    }
    assertEquals(
      new Set(EMAIL_KINDS.map((k) => EMAIL_KIND_LABEL[k].short)).size,
      EMAIL_KINDS.length,
    );
    // one button per kind on the lead, each opening the panel on its own kind
    assert(leads.includes("{EMAIL_KINDS.map((k) => ("));
    assert(leads.includes("onClick={() => onSend(k)}"));
    assert(leads.includes("data-quick-email={k}"));
    assert(leads.includes("(kind) => openSend(openRow, kind)"));
    // the email shows on the lead's page (it used to open behind it), and closes with it
    assert(leads.includes("sending && sending.leadId === openRow.id ? ("));
    assert(leads.includes("{sending && sending.leadId == null && ("));
    assert(leads.includes("setSending((s) => (s?.leadId != null ? null : s));"));
    assert(
      !leads.includes("Send the application\n"),
      "the one hidden button is gone from the lead",
    );
    assert(panel.includes('useState<EmailKind>(startKind ?? "apply")'));
  },
);

Deno.test("the database's allowed list names the new kind, in one statement", () => {
  assert(thanksSql.includes("('apply', 'thanks', 'later', 'options', 'offer')"));
  assert(
    /drop constraint if exists application_invites_email_kind_check,\s+add constraint/.test(
      thanksSql,
    ),
  );
  // until that file is run, the link still goes out: a refused value is retried without the column
  assert(server.includes('e.code === "23514"'));
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
  for (const k of ["thanks", "later", "options", "offer"] as const) assertEquals(linkDays(k), 90);
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

Deno.test("the merchant sees the rep who sent it; whoever they report to is copied in", () => {
  // the name on every application email, the application page and the PDF's rep box is the rep's own
  assert(
    server.includes(
      "const facing = (r: Rep) => ({ name: r.name, title: r.title, user_id: r.user_id });",
    ),
  );
  // every application email copies the person the rep reports to, for admins and reps alike
  assertEquals(server.split("cc: await ccFor(svc, rep),").length - 1, 4);
  assert(!server.includes("!isAdmin) {"));
  // the panel previews the rep's own name and says who is copied
  assert(panel.includes("const facingName = senderName;"));
  assert(panel.includes("copied to ${leadName}"));
});

Deno.test("the email carries the copy as a Cc header, and refuses a broken address", () => {
  const raw = buildAltMime({
    from: "Zeus at Lamp <partners@getlamp.app>",
    to: "merchant@example.com",
    cc: "stevie@getlamp.app",
    replyTo: "zeus@getlamp.app, stevie@getlamp.app",
    subject: "Your Lamp application",
    text: "Hi",
  });
  assert(raw.includes("\r\nCc: stevie@getlamp.app\r\n"));
  assert(
    !buildAltMime({ from: "a <b@c.d>", to: "x@y.z", subject: "s", text: "t" }).includes("Cc:"),
  );
  let threw = false;
  try {
    buildAltMime({
      from: "a <b@c.d>",
      to: "x@y.z",
      cc: "evil@x.z\r\nBcc: all@x.z",
      subject: "s",
      text: "t",
    });
  } catch {
    threw = true;
  }
  assert(threw, "a header break in the copy is refused");
});

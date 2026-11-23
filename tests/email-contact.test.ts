// deno test --node-modules-dir=none tests/email-contact.test.ts
//
// Asad, 2026-11-23: "my phone number should be in there and encourage them to email us directly
// too." Every email Lamp sends in a rep's name now ends with three ways to reach a person: reply,
// write to the mailbox, or call or text the rep when Lamp has their number.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  contactLine,
  DIRECT_EMAIL,
  finishEmail,
  fmtPhone,
  inviteEmail,
} from "../src/lib/application-links.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import funder from "../src/lib/funder-send.server.ts" with { type: "text" };
import migration from "../supabase/migrations/20261123210000_rep_phone.sql" with { type: "text" };
import panel from "../src/components/staff/send-applications.tsx" with { type: "text" };

const base = {
  firstName: "Dana",
  businessName: "Vella Interiors",
  repName: "Asad Matsumoto",
  note: "",
  url: "https://getlamp.app/application/asad?i=" + "t".repeat(43),
  legalName: "Lamp Capital Group LLC",
  address: "",
};

Deno.test(
  "phone: written one way however it was typed, and nothing for a number that isn't one",
  () => {
    for (const raw of [
      "908-765-8526",
      "(908) 765-8526",
      "9087658526",
      "+1 908 765 8526",
      "1-908-765-8526",
    ])
      assertEquals(fmtPhone(raw), "908-765-8526");
    for (const raw of ["", null, undefined, "765-8526", "12345678901234"])
      assertEquals(fmtPhone(raw), "");
  },
);

Deno.test(
  "email: with a number, the merchant is told all three ways and the sign-off carries it",
  () => {
    const m = inviteEmail({ ...base, repPhone: "(908) 765-8526" });
    assert(
      m.text.includes(
        `Questions? Reply to this email, email us directly at ${DIRECT_EMAIL}, or call or text me at 908-765-8526.`,
      ),
    );
    assert(m.text.includes("Asad Matsumoto\r\nLamp · 908-765-8526 · getlamp.app"));
    // in the designed email the number and the address are links, never typed-out web addresses
    assert(m.html.includes('<a href="tel:+19087658526"') && m.html.includes(">908-765-8526</a>"));
    assert(m.html.includes(`<a href="mailto:${DIRECT_EMAIL}"`));
  },
);

Deno.test("email: without a number it says so in two ways and invents none", () => {
  const m = inviteEmail(base);
  assertEquals(
    contactLine(""),
    `Questions? Reply to this email, or email us directly at ${DIRECT_EMAIL}.`,
  );
  assert(m.text.includes(contactLine("")));
  assert(m.text.includes("Asad Matsumoto\r\nLamp · getlamp.app"));
  assert(!m.html.includes("tel:") && !m.text.includes("call or text"));
});

Deno.test("email: every kind and the finish email carry it", () => {
  for (const kind of ["apply", "thanks", "later", "options", "offer"] as const) {
    const m = inviteEmail({ ...base, kind, repPhone: "9087658526" });
    assert(m.text.includes("call or text me at 908-765-8526"), kind);
    assert(m.text.includes(DIRECT_EMAIL), kind);
  }
  const f = finishEmail({
    firstName: "Dana",
    businessName: "Vella Interiors",
    repName: "Asad Matsumoto",
    site: "https://getlamp.app",
    legalName: "Lamp Capital Group LLC",
    address: "",
    repPhone: "908-765-8526",
  });
  assert(f.text.includes("call or text me at 908-765-8526") && f.html.includes("tel:+19087658526"));
});

Deno.test("the address merchants are told to write to is the mailbox the emails come from", () => {
  assert(funder.includes(`env("FUNDER_MAILBOX") || "${DIRECT_EMAIL}"`));
});

Deno.test(
  "server: the rep's number comes from their own row, and a database without the column still sends",
  () => {
    assert(
      server.includes(
        'let r = await svc.from("reps").select(`${cols},phone`).eq("slug", slug).maybeSingle();',
      ),
    );
    assert(server.includes('r.error.code === "42703" || r.error.code === "PGRST204"'));
    assertEquals(server.split("repPhone: rep.phone,").length - 1, 3);
    assertEquals(server.split("repPhone: rep?.phone ?? null,").length - 1, 2);
  },
);

Deno.test(
  "staff: the preview shows the sender's number, so what they read is what goes out",
  () => {
    assert(panel.includes("repPhone: senderRep?.phone ?? null,"));
  },
);

Deno.test(
  "database: a number is a staff-only column on reps, checked, and Asad's is set once",
  () => {
    assert(migration.includes("alter table public.reps add column if not exists phone text;"));
    assert(migration.includes("reps_phone_ok"));
    assert(migration.includes("where slug = 'asad' and phone is null;"));
    // no grant to visitors or merchants
    assert(!/grant[^;]*phone[^;]*to\s+(anon|authenticated)/i.test(migration));
  },
);

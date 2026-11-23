// deno test --node-modules-dir=none tests/resend-prefilled.test.ts
//
// Asad, 2026-11-23: "we're always sending a link to a prefilled or partially filled out
// application if we're resending a link to complete the application." A merchant had been sent a
// blank second application beside the one a rep filled in with him, and each resend had replaced
// the link in the email before it. Send now sends the application the merchant already has open,
// and Resend keeps its link.
import { assert } from "jsr:@std/assert@1";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import sentList from "../src/components/staff/sent-applications.tsx" with { type: "text" };

const resend = server.slice(
  server.indexOf('body.action === "cancel" || body.action === "resend"'),
  server.indexOf('body.action !== "send"'),
);
const send = server.slice(
  server.indexOf('body.action !== "send"'),
  server.indexOf("// ---------- POST /api/application/open"),
);
const finder = server.slice(
  server.indexOf("async function openInvite("),
  server.indexOf("export async function applicationInvites("),
);

Deno.test("resend: the application keeps its link, so the earlier emails still open it", () => {
  assert(
    resend.includes(
      "const same = had ? await sameLink(svc, rep.slug, { id: inv.id, token_hash: had.token_hash }) : null;",
    ) ||
      /const same = had\s*\?\s*await sameLink\(svc, rep\.slug, \{ id: inv\.id, token_hash: had\.token_hash \}\)\s*:\s*null;/.test(
        resend,
      ),
  );
  // the token is only replaced when the same link cannot be made
  assert(resend.includes("const token = same ? null : newToken();"));
  assert(resend.includes("...(token ? { token_hash: await hashToken(token) } : {}),"));
  assert(resend.includes("const url = same ?? applicationUrl(SITE_URL(), rep.slug, token);"));
});

Deno.test("resend: one a rep filled in says so in the email", () => {
  assert(resend.includes('const filled = kind === "apply" && !!had?.draft_saved_at;'));
  assert(resend.includes("...(filled ? { filled: true } : {}),"));
});

Deno.test("send: the merchant's open application is looked for before any new one is made", () => {
  const look = send.indexOf("again = await openInvite(svc, rep.slug, lead?.id ?? null, email);");
  const insert = send.indexOf(".insert(");
  assert(look > 0 && insert > look);
  // a new row only when there is none to send again
  const branch = send.slice(send.indexOf("if (again && againUrl) {"), insert);
  assert(branch.includes('.eq("id", again.id)') && branch.includes("} else {"));
  assert(branch.includes("inviteId = again.id;") && branch.includes("url = againUrl;"));
});

Deno.test("send: a lookup that fails sends nothing rather than a blank second application", () => {
  assert(send.includes('detail: "Couldn\'t check for an open application."'));
});

Deno.test("send: open means this rep's, not signed, not stopped, not expired", () => {
  for (const cond of [
    '.eq("rep_slug", repSlug)',
    '.is("submitted_at", null)',
    '.is("cancelled_at", null)',
    '.gt("expires_at", new Date().toISOString())',
  ])
    assert(finder.includes(cond), cond);
  // the lead's first, then the address; one a rep filled in before a blank one
  assert(finder.includes('(leadId ? await find("engine_lead_id", leadId) : null) ??'));
  assert(finder.includes('.order("draft_saved_at", { ascending: false, nullsFirst: false })'));
});

Deno.test("send: an email that fails never stops an application that was already open", () => {
  const stops = [...send.matchAll(/cancelled_at: new Date\(\)\.toISOString\(\)/g)];
  assert(stops.length === 2);
  assert(send.split("...(reused ? {} : { cancelled_at: new Date().toISOString() }),").length === 3);
});

Deno.test(
  "send: says it was their open application, and that a rep filled it in only when one did",
  () => {
    assert(
      send.includes(
        "detail: reused ? `Emailed ${email} their open application` : `Emailed ${email}`,",
      ),
    );
    assert(send.includes('const filled = reused && kind === "apply" && !!again?.draft_saved_at;'));
  },
);

Deno.test("the same link is signed against the application's own hash, like a reminder's", () => {
  const same = server.slice(
    server.indexOf("async function sameLink("),
    server.indexOf("type OpenInvite"),
  );
  assert(same.includes("await remindToken(secret, invite.id, invite.token_hash)"));
  assert(same.includes("if (!secret) return null;"));
});

Deno.test("staff screen: Email again and the link to copy no longer say the old link stops", () => {
  assert(!sentList.includes("The link sent before stops working"));
  assert(sentList.includes("Their answers so far are kept."));
});

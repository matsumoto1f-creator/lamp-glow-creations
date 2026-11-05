// deno test --node-modules-dir=none tests/slack.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  channelKey,
  channelText,
  dmText,
  esc,
  freshTimestamp,
  lampLink,
  leadsText,
  parseCommand,
  signatureBase,
  todayText,
  type SlackNotification,
} from "../src/lib/slack.ts";

const SITE = "https://getlamp.app";
const n = (o: Partial<SlackNotification>): SlackNotification => ({
  id: 1,
  kind: "file",
  title: "New file: Joe's <Deli> & Co",
  body: "Signed from an application link.",
  link: "/staff?file=abc",
  application_id: "abc",
  ...o,
});

Deno.test("dm: title, body and a link back into Lamp, escaped", () => {
  const t = dmText(n({}), SITE);
  assertEquals(
    t,
    "*New file: Joe's &lt;Deli&gt; &amp; Co*\nSigned from an application link.\n<https://getlamp.app/staff?file=abc|Open in Lamp>",
  );
});

Deno.test("links: only paths on the site", () => {
  assertEquals(lampLink(SITE, "/staff"), "https://getlamp.app/staff");
  assertEquals(lampLink(SITE, "https://evil.example"), null);
  assertEquals(lampLink(SITE, "//evil.example"), null);
  assertEquals(lampLink(SITE, null), null);
  assert(
    dmText(n({ link: "javascript:x" }), SITE).endsWith("<https://getlamp.app/staff|Open in Lamp>"),
  );
});

Deno.test("channel: deal events once per event, with the rep", () => {
  assertEquals(channelKey(n({})), "file:abc");
  assertEquals(channelKey(n({ kind: "funded" })), "funded:abc");
  assertEquals(channelKey(n({ kind: "assigned" })), null);
  assertEquals(channelKey(n({ kind: "document" })), null);
  assertEquals(channelKey(n({ application_id: null })), null);
  assert(
    channelText(n({ kind: "funded", title: "Funded: ISK" }), SITE, "Zeus").startsWith(
      ":moneybag: *Funded: ISK* · Zeus",
    ),
  );
});

Deno.test("command: today, lead search, help", () => {
  assertEquals(parseCommand(""), { cmd: "help" });
  assertEquals(parseCommand("help"), { cmd: "help" });
  assertEquals(parseCommand(" Today "), { cmd: "today" });
  assertEquals(parseCommand("lead  ISK   construction"), {
    cmd: "lead",
    query: "ISK construction",
  });
  assertEquals(parseCommand("718-555"), { cmd: "lead", query: "718-555" });
  assertEquals(parseCommand("x"), { cmd: "help" });
});

Deno.test("signature: Slack's base string and the five-minute window", () => {
  assertEquals(
    signatureBase("1531420618", "token=x&text=today"),
    "v0:1531420618:token=x&text=today",
  );
  const now = 1_700_000_000_000;
  assert(freshTimestamp("1700000000", now));
  assert(freshTimestamp("1699999800", now));
  assert(!freshTimestamp("1699999600", now));
  assert(!freshTimestamp("abc", now));
});

Deno.test("answers: today and lead hits read plainly", () => {
  const t = todayText("Zeus", { new: 28, callback: 2, dead: 0 }, { submitted: 1 }, SITE);
  assert(t.includes("Engine leads: 28 new, 2 callback"));
  assert(t.includes("Files: 1 submitted"));
  assert(!t.includes("dead"));
  assertEquals(leadsText("zz", [], false), 'No leads of yours match "zz".');
  const l = leadsText(
    "isk",
    [
      {
        name: "ISK CONSTRUCTION",
        phone: "3473800756",
        contact_phone: null,
        status: "no_answer",
        owner: "Gjovalin Celaj",
        city: "BRONX",
        state: "NY",
      },
    ],
    true,
  );
  assertEquals(
    l,
    "• *ISK CONSTRUCTION* (BRONX, NY) · ask for Gjovalin Celaj · 3473800756 · no answer\n_More match; add a word to narrow it._",
  );
  assertEquals(esc("<@U123>"), "&lt;@U123&gt;");
});

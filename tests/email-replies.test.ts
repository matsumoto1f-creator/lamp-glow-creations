// deno test --node-modules-dir=none tests/email-replies.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  MAX_REPLIES,
  mergeSignals,
  parseReplies,
  recipients,
  replyNote,
  replyRecords,
  type Reply,
} from "../src/lib/email-replies.ts";
import { leadRecords, leadType } from "../src/lib/engine-leads.ts";

const raw = (over: Record<string, unknown> = {}) => ({
  source_key: "lamp:summit-remodeling-llc",
  sender: "Asad",
  kind: "person",
  message_id: "m-1",
  words: "Yes, call Tony at 908-555-0100 after 2.",
  from: "office@summit.example",
  subject: "Re: Does Summit Remodeling buy materials before the last job pays?",
  replied_at: "2026-11-12T14:05:00",
  name: "Summit Remodeling",
  email: "mike@summit.example",
  phone: "908-555-0100",
  city: "Westfield",
  state: "nj",
  industry: "contractor",
  list: "nj_hic",
  list_label: "NJ home improvement contractor registry",
  ...over,
});
const one = (over: Record<string, unknown> = {}): Reply =>
  parseReplies({ replies: [raw(over)] }, ["asad", "stevie"]).replies[0];

Deno.test("replies: a good reply goes in, normalised", () => {
  const { replies, problems } = parseReplies({ replies: [raw()] }, ["asad"]);
  assertEquals(problems, []);
  assertEquals(replies[0].sender, "asad");
  assertEquals(replies[0].state, "NJ");
  assertEquals(replies[0].kind, "person");
  assertEquals(replies[0].replied_at, "2026-11-12T14:05:00");
});

Deno.test("replies: only a rep with a login owns a reply", () => {
  const { replies, problems } = parseReplies({ replies: [raw({ sender: "zeus" })] }, ["asad"]);
  assertEquals(replies.length, 0);
  assert(problems[0].includes('"zeus" is not a rep with a login'));
});

Deno.test("replies: bad kind, no message id, a repeated message and a bad date", () => {
  const { replies, problems } = parseReplies(
    {
      replies: [
        raw({ kind: "maybe" }),
        raw({ message_id: "" }),
        raw({ message_id: "m-2" }),
        raw({ message_id: "m-2" }),
        raw({ message_id: "m-3", replied_at: "yesterday" }),
      ],
    },
    ["asad"],
  );
  assertEquals(replies.length, 2);
  assertEquals(problems.length, 3);
  assertEquals(replies[1].replied_at, null);
});

Deno.test("replies: not a list, or too many at once, is refused whole", () => {
  assertEquals(parseReplies({}, ["asad"]).problems, ["Send { replies: [...] }."]);
  const many = Array.from({ length: MAX_REPLIES + 1 }, (_, i) => raw({ message_id: `m${i}` }));
  assertEquals(parseReplies({ replies: many }, ["asad"]).replies.length, 0);
});

Deno.test("replies: long words are cut, nothing is lost silently", () => {
  assertEquals(one({ words: "x".repeat(5000) }).words.length, 1500);
});

Deno.test(
  "signals: a reply adds its list and its words once; the same message again adds nothing",
  () => {
    const r = one();
    const first = mergeSignals([], r);
    assert(first.fresh);
    assertEquals(first.signals.length, 2);
    assertEquals(leadType(first.signals), "contractor");
    const again = mergeSignals(first.signals, r);
    assertEquals(again.fresh, false);
    assertEquals(again.signals.length, 2);
    const second = mergeSignals(first.signals, one({ message_id: "m-9", words: "Friday works" }));
    assert(second.fresh);
    assertEquals(second.signals.length, 3);
  },
);

Deno.test("signals: earlier signals on the lead are kept", () => {
  const old = [
    { source: "x", signal_type: "nyc_permit", signal_date: "2026-10-01", detail: "1 job" },
  ];
  const { signals } = mergeSignals(old, one({ list: "nyc_permit" }));
  assertEquals(signals.length, 2);
  assertEquals(signals[0], old[0]);
});

Deno.test("signals: the words show on the lead page and in the replies list", () => {
  const { signals } = mergeSignals([], one());
  const page = leadRecords(signals);
  assert(
    page.some(
      (x) => x.label === "Replied to the Lamp email" && (x.detail ?? "").includes("call Tony"),
    ),
  );
  const list = replyRecords(signals);
  assertEquals(list.length, 1);
  assertEquals(list[0].kind, "reply");
  assert(list[0].detail.includes("from office@summit.example"));
  const out = replyRecords(mergeSignals([], one({ kind: "optout", words: "stop" })).signals);
  assertEquals(out[0].kind, "optout");
});

Deno.test("note: the sender is named, an opt-out reads as one, the words are quoted", () => {
  const n = replyNote(one(), "Asad Matsumoto");
  assertEquals(n.title, "Summit Remodeling replied to Asad Matsumoto's email");
  assert(n.body.startsWith('"Yes, call Tony'));
  assert(n.body.includes("From office@summit.example · NJ home improvement contractor registry"));
  assert(
    replyNote(one({ kind: "maybe_optout" }), "Asad").title.endsWith("(reads like an opt-out)"),
  );
  assertEquals(
    replyNote(one({ kind: "optout" }), "Asad").title,
    "Summit Remodeling asked Lamp to stop emailing",
  );
  assert(replyNote(one({ words: "x".repeat(1500) }), "Asad").body.length <= 1000);
});

Deno.test("recipients: the sender, then every admin, each once", () => {
  assertEquals(recipients("u-asad", ["u-asad", "u-stevie", "u-zeus"]), [
    "u-asad",
    "u-stevie",
    "u-zeus",
  ]);
  assertEquals(recipients("u-rep", ["u-stevie"]), ["u-rep", "u-stevie"]);
  assertEquals(recipients(null, ["u-stevie"]), ["u-stevie"]);
});

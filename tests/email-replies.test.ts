// deno test --node-modules-dir=none tests/email-replies.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  MAX_REPLIES,
  mergeSignals,
  parseReplies,
  planReply,
  recipients,
  replyNote,
  replyRecords,
  type Reply,
  type Seat,
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
  parseReplies({ replies: [raw(over)] }).replies[0];

// Lamp's staff as the portal holds them: three admins, a rep, a rep not signed in yet, a rep switched off.
const SEATS: Seat[] = [
  { slug: "asad", name: "Asad Matsumoto", user_id: "u-asad", active: true },
  { slug: "stevie", name: "Stevie Marshall", user_id: "u-stevie", active: true },
  { slug: "zeus", name: "Zeus", user_id: "u-zeus", active: true },
  { slug: "darrell", name: "Darrell Alston", user_id: "u-darrell", active: true },
  { slug: "christian", name: "Christian Melrose", user_id: null, active: true },
  { slug: "old", name: "Old Rep", user_id: "u-old", active: false },
];
const ADMINS = ["u-asad", "u-stevie", "u-zeus"];

Deno.test("parse: a good reply goes in, normalised", () => {
  const { replies, rejected } = parseReplies({ replies: [raw()] });
  assertEquals(rejected, []);
  assertEquals(replies[0].sender, "asad");
  assertEquals(replies[0].state, "NJ");
  assertEquals(replies[0].kind, "person");
  assertEquals(replies[0].replied_at, "2026-11-12T14:05:00");
  assertEquals(one({ replied_at: "2026-11-12 14:05" }).replied_at, "2026-11-12T14:05");
});

Deno.test("parse: a sender who is not a rep with a login is NOT a reason to refuse", () => {
  const { replies, rejected } = parseReplies({
    replies: [raw({ sender: "christian" }), raw({ message_id: "m-2", sender: "" })],
  });
  assertEquals(rejected, []);
  assertEquals(replies.length, 2);
});

Deno.test("parse: what cannot be filed is refused, named by its message id", () => {
  const { replies, rejected } = parseReplies({
    replies: [
      raw({ kind: "maybe" }),
      raw({ message_id: "" }),
      raw({ message_id: "m-2" }),
      raw({ message_id: "m-2" }),
      raw({ message_id: "m-3", replied_at: "yesterday" }),
    ],
  });
  assertEquals(
    replies.map((r) => r.message_id),
    ["m-2", "m-3"],
  );
  assertEquals(
    rejected.map((x) => x.message_id),
    ["m-1", null, "m-2"],
  );
  assert(rejected[0].problem.includes("kind should be"));
  assertEquals(replies[1].replied_at, null);
});

Deno.test(
  "parse: exactly the engine's batch size is fine; one more, or not a list, is refused whole",
  () => {
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => raw({ message_id: `m${i}` }));
    assertEquals(parseReplies({ replies: full }).replies.length, MAX_REPLIES);
    const many = [...full, raw({ message_id: "extra" })];
    assertEquals(parseReplies({ replies: many }).replies.length, 0);
    assertEquals(parseReplies({}).rejected[0].problem, "Send { replies: [...] }.");
  },
);

Deno.test("parse: long words are cut", () => {
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

Deno.test("signals: the words show on the lead page and in the replies list, newest first", () => {
  const a = mergeSignals([], one({ replied_at: "2026-11-12T09:00" })).signals;
  const b = mergeSignals(
    a,
    one({ message_id: "m-2", kind: "optout", words: "stop", replied_at: "2026-11-12T16:00" }),
  ).signals;
  const page = leadRecords(b);
  assert(
    page.some(
      (x) => x.label === "Replied to the Lamp email" && (x.detail ?? "").includes("call Tony"),
    ),
  );
  assert(page.some((x) => x.label === "Asked Lamp to stop emailing"));
  const list = replyRecords(b);
  assertEquals(
    list.map((x) => x.kind),
    ["optout", "reply"],
  );
  assert(list[1].detail.includes("from office@summit.example"));
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

Deno.test("recipients: the owner, then every admin, each once", () => {
  assertEquals(recipients("u-asad", ADMINS), ADMINS);
  assertEquals(recipients("u-rep", ["u-stevie"]), ["u-rep", "u-stevie"]);
  assertEquals(recipients(null, ["u-stevie"]), ["u-stevie"]);
});

Deno.test(
  "plan: a new reply to Darrell's email is Darrell's, and Darrell plus every admin are told",
  () => {
    const p = planReply(null, one({ sender: "darrell" }), SEATS, ADMINS)!;
    assertEquals(p.row.rep_slug, "darrell");
    assertEquals(p.tell, ["u-darrell", ...ADMINS]);
    assertEquals(p.note.title, "Summit Remodeling replied to Darrell Alston's email");
    assertEquals(p.row.tier, "A");
    assertEquals("status" in p.row, false); // a new row starts at "new"; an old one keeps what staff set
    assert(typeof p.row.pushed_at === "string");
  },
);

Deno.test(
  "plan: a sender who cannot sign in, is switched off, or is unknown: unassigned, admins only, still saved",
  () => {
    for (const sender of ["christian", "old", "nobody", ""]) {
      const p = planReply(null, one({ sender }), SEATS, ADMINS)!;
      assertEquals(p.row.rep_slug, null, sender);
      assertEquals(p.tell, ADMINS, sender);
    }
  },
);

Deno.test(
  "plan: a lead staff handed to Darrell stays his, and the next reply tells Darrell, not the old sender",
  () => {
    const first = planReply(null, one(), SEATS, ADMINS)!;
    const old = { signals: first.row.signals, rep_slug: "darrell", phone: null, email: null };
    const p = planReply(old, one({ message_id: "m-2" }), SEATS, ADMINS)!;
    assertEquals(p.row.rep_slug, "darrell");
    assertEquals(p.tell, ["u-darrell", ...ADMINS]);
    assertEquals(p.note.title, "Summit Remodeling replied to Asad Matsumoto's email"); // whose email it was
    const loose = planReply({ ...old, rep_slug: null }, one({ message_id: "m-3" }), SEATS, ADMINS)!;
    assertEquals(loose.row.rep_slug, null); // "unassigned" chosen by staff is kept
    assertEquals(loose.tell, ADMINS);
  },
);

Deno.test("plan: an opt-out is filed as do not call, never as a lead to work", () => {
  const p = planReply(null, one({ kind: "optout", words: "Stop" }), SEATS, ADMINS)!;
  assertEquals(p.row.status, "do_not_call");
  assertEquals(p.row.tier, "X");
  assertEquals(p.row.reason, "Asked Lamp to stop emailing");
});

Deno.test("plan: the same message again changes nothing and tells no one", () => {
  const first = planReply(null, one(), SEATS, ADMINS)!;
  const old = { signals: first.row.signals, rep_slug: "asad", phone: null, email: null };
  assertEquals(planReply(old, one(), SEATS, ADMINS), null);
});

Deno.test("plan: a phone or email already on the lead is not wiped by a reply without one", () => {
  const p = planReply(
    { signals: [], rep_slug: "asad", phone: "908-555-0199", email: "x@y.example" },
    one({ phone: null, email: null }),
    SEATS,
    ADMINS,
  )!;
  assertEquals(p.row.phone, "908-555-0199");
  assertEquals(p.row.email, "x@y.example");
});

Deno.test("list: two replies with the same time show the later-written one first", () => {
  const a = mergeSignals(
    [],
    one({ message_id: "first", words: "one", replied_at: "2026-11-12T09:00" }),
  ).signals;
  const b = mergeSignals(
    a,
    one({ message_id: "second", words: "two", replied_at: "2026-11-12T09:00" }),
  ).signals;
  assert(replyRecords(b)[0].detail.startsWith("two"));
});

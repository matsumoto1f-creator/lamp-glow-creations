// Calendar (2026-11-15, docs/calendar.md): the rules that schedule follow-ups from what the portal
// already records. Plain functions with no database or network, so the server route
// (calendar.server.ts), the page and the tests all run the same rules.
//
//   planCalendar(input, now)              every item the records call for right now
//   reconcile(existing, desired, scope)   what to add, update and clear so the table matches
//
// An item is only ever made from a recorded fact (a column with a value). Where the portal doesn't
// record something, such as the day a merchant asked to be called back, the item says what it
// assumed and the person moves it.

export const RULES = [
  "assigned_call",
  "email_reply",
  "link_unopened",
  "link_unstarted",
  "link_unfinished",
  "offer_waiting",
  "funder_silent",
  "docs_missing",
  "lead_callback",
  "lead_no_answer",
  "emails_to_approve",
] as const;
export type Rule = (typeof RULES)[number];

export const RULE_LABEL: Record<Rule, string> = {
  assigned_call: "Call assigned",
  email_reply: "Email reply",
  link_unopened: "Link not opened",
  link_unstarted: "Opened, not started",
  link_unfinished: "Started, not finished",
  offer_waiting: "Offer waiting",
  funder_silent: "Funder quiet",
  docs_missing: "Documents not in",
  lead_callback: "Callback",
  lead_no_answer: "No answer",
  emails_to_approve: "Emails to approve",
};

/** What clears an item on its own, said on the item once it has. */
export const RULE_CLEARS: Record<Rule, string> = {
  assigned_call: "the call was marked done",
  email_reply: "the lead was worked",
  link_unopened: "the link was opened, filed, cancelled or ran out",
  link_unstarted: "the application was started, filed, cancelled or ran out",
  link_unfinished: "the application was submitted, cancelled or ran out",
  offer_waiting: "the offer was answered, withdrawn or ran out",
  funder_silent: "the funder's answer was recorded",
  docs_missing: "documents came in or the request closed",
  lead_callback: "the lead's status changed",
  lead_no_answer: "the lead's status changed",
  emails_to_approve: "nothing is waiting for that day",
};

export const LINK_DAYS = 2; // business days after a link goes out (or is opened) with nothing more
export const UNFINISHED_DAYS = 1; // business days after the last saved step of a started application
export const OFFER_DAYS = 3; // business days after an offer with no expiry is presented
export const OFFER_EXPIRY_LEAD_HOURS = 24; // an offer that expires: the day before
export const FUNDER_DAYS = 2;
export const DOCS_DAYS = 2;
export const CALLBACK_WINDOW_DAYS = 30; // a Callback set longer ago than this makes no item
export const NO_ANSWER_WINDOW_DAYS = 14;
export const OUTBOX_WINDOW_DAYS = 7;
export const DAY_START = { hour: 9, minute: 0 }; // an all-day item sits at 9:00 New York time
export const APPROVE_AT = { hour: 8, minute: 30 };

const TZ = "America/New_York";
const DAY = 86_400_000;
const OPEN_FILE = new Set([
  "new",
  "reviewing",
  "docs_needed",
  "submitted",
  "offers_ready",
  "accepted",
  "closing",
]);

// ---------- New York days ----------

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const has = (iso: string | null | undefined) => !Number.isNaN(ms(iso));

/** The New York calendar day of a moment, as YYYY-MM-DD. */
export const nyDay = (t: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(t));

const wall = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

/** The New York wall clock at a moment. */
function wallParts(t: number) {
  const p = new Map<string, number>(
    wall.formatToParts(new Date(t)).map((x) => [x.type as string, Number(x.value)]),
  );
  const n = (k: string) => p.get(k) ?? 0;
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hour: n("hour"),
    minute: n("minute"),
  };
}

/** Minutes New York is ahead of UTC at a moment (negative: -300 in winter, -240 in summer). */
function nyOffset(t: number): number {
  const p = wallParts(t);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(t / 60_000) * 60_000) / 60_000);
}

/** The moment it is hour:minute in New York on a YYYY-MM-DD day. */
export function nyAt(day: string, hour: number, minute = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  const naive = Date.UTC(y!, m! - 1, d!, hour, minute);
  const first = naive - nyOffset(naive) * 60_000;
  const second = naive - nyOffset(first) * 60_000;
  return second;
}

const weekday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
};
export const shiftDay = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};
export const isWeekend = (day: string) => weekday(day) === 0 || weekday(day) === 6;

/** The New York day n business days after a moment (Saturday and Sunday skipped; n = 0 rolls a weekend to Monday). */
export function businessDay(t: number, n: number): string {
  let day = nyDay(t);
  let left = n;
  while (isWeekend(day)) day = shiftDay(day, 1);
  while (left > 0) {
    day = shiftDay(day, 1);
    if (!isWeekend(day)) left--;
  }
  return day;
}

/** "Fri Nov 13" in New York time. */
export const sayDay = (t: number) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(t));

const dayAt = (day: string) => nyAt(day, DAY_START.hour, DAY_START.minute);

// ---------- a callback's day and time, as the rep picks it on the lead (New York time) ----------

/**
 * The moment to store for a picked day ("2026-11-25") and time ("14:30", or "" for no time).
 * No time is stored as midnight and shows as an all-day item. Null when either isn't a real value.
 */
export function callbackAt(day: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!d) return null;
  const real = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
  if (real.toISOString().slice(0, 10) !== day) return null;
  if (time === "") return new Date(nyAt(day, 0, 0)).toISOString();
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  return new Date(nyAt(day, Number(m[1]), Number(m[2]))).toISOString();
}

/** True when a stored callback is a day with no time (midnight in New York). */
export function isDayOnly(at: string): boolean {
  const p = wallParts(ms(at));
  return p.hour === 0 && p.minute === 0;
}

/** A stored callback as the two boxes show it: { day: "2026-11-25", time: "14:30" } (time "" for none). */
export function callbackParts(at: string | null | undefined): { day: string; time: string } {
  if (!has(at)) return { day: "", time: "" };
  const p = wallParts(ms(at));
  const two = (n: number) => String(n).padStart(2, "0");
  return {
    day: nyDay(ms(at)),
    time: p.hour === 0 && p.minute === 0 ? "" : `${two(p.hour)}:${two(p.minute)}`,
  };
}

/** "Wed, Nov 25 at 2:30 PM" (New York time), or just the day when no time was picked. */
export function sayCallback(at: string): string {
  const day = sayDay(ms(at));
  return isDayOnly(at) ? day : `${day} at ${sayTime(at)}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1).trimEnd()}…` : flat;
};

// ---------- what the rules read ----------

export type CalSeat = { slug: string; user_id: string | null; active: boolean };
export type CalFile = {
  id: string;
  status: string;
  rep_slug: string | null;
  business_name: string | null;
  first_name: string | null;
};
export type CalCall = {
  id: number | string;
  application_id: string | null;
  lead_id: string | null;
  assigned_to: string;
  due_on: string | null;
  body: string;
  author_name: string | null;
  created_at: string;
};
export type CalLead = { id: string; name: string | null; rep_slug: string | null };
export type CalEngineLead = {
  id: number;
  source: string;
  name: string | null;
  status: string;
  rep_slug: string | null;
  worked_at: string | null;
  pushed_at: string | null;
  signals: unknown;
  /** the day and time the rep picked for a Callback; absent until that column exists */
  callback_at?: string | null;
};
export type CalInvite = {
  id: string;
  rep_slug: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  sent_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  draft_saved_at: string | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  expires_at: string;
  application_id: string | null;
};
export type CalOffer = {
  id: string;
  application_id: string;
  status: string;
  presented_at: string | null;
  expires_at: string | null;
  funder: string | null;
};
export type CalSubmission = {
  id: string;
  application_id: string;
  status: string;
  submitted_at: string;
  decided_at: string | null;
  submitted_by: string | null;
  funder: string | null;
};
export type CalDocRequest = {
  id: string;
  application_id: string;
  title: string;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
  received: number;
};
export type CalOutboxDay = { batch_date: string; pending: number };

export type CalInput = {
  seats: CalSeat[];
  /** user ids of every admin */
  admins: string[];
  /** every file the other rows point at (any stage; closed ones make nothing) */
  files: CalFile[];
  calls: CalCall[];
  leads: CalLead[];
  engineLeads: CalEngineLead[];
  invites: CalInvite[];
  offers: CalOffer[];
  submissions: CalSubmission[];
  docRequests: CalDocRequest[];
  outbox: CalOutboxDay[];
  /** the rules whose records were read; an item of a rule missing here is never cleared */
  loaded: Rule[];
};

export type Desired = {
  rule: Rule;
  source_key: string;
  owner: string | null;
  rep_slug: string | null;
  title: string;
  why: string;
  link: string;
  due_at: string;
  all_day: boolean;
  application_id: string | null;
  lead_id: string | null;
  engine_lead_id: number | null;
  invite_id: string | null;
};

const fileLink = (id: string) => `/staff?file=${id}`;
const engineLink = (id: number) => `/staff?view=engine&elead=${id}`;

/** Every item the records call for at `now`, one per business per person (see mergeSameBusiness). */
export function planCalendar(input: CalInput, now: Date): Desired[] {
  return planWithMerges(input, now).items;
}

/** The plan, plus the keys of items folded into another item for the same business. */
export function planWithMerges(
  input: CalInput,
  now: Date,
): { items: Desired[]; absorbed: string[] } {
  const engineName = new Map(input.engineLeads.map((l) => [l.id, l.name]));
  const inviteName = new Map(
    input.invites.map((i) => [
      i.id,
      i.business_name?.trim() || [i.first_name, i.last_name].filter(Boolean).join(" "),
    ]),
  );
  return mergeSameBusiness(planEach(input, now), (d) =>
    d.invite_id
      ? (inviteName.get(d.invite_id) ?? null)
      : d.engine_lead_id != null
        ? (engineName.get(d.engine_lead_id) ?? null)
        : null,
  );
}

/** Rules that ask a person to call a business, so two of them for one business are one call. */
const CALL_RULES: Rule[] = [
  "link_unfinished",
  "lead_callback",
  "link_unstarted",
  "link_unopened",
  "lead_no_answer",
];

/** "Caveman Flooring, L.L.C." and "CAVEMAN FLOORING LLC" are one business. */
export function businessKey(name: string | null | undefined): string {
  const words = (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !SUFFIXES.has(w));
  return words.join(" ");
}
const SUFFIXES = new Set([
  "llc",
  "l",
  "c",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "pllc",
  "lp",
  "llp",
  "the",
]);

const alsoSay = (d: Desired) =>
  d.rule.startsWith("link_")
    ? `another application link (${RULE_LABEL[d.rule].toLowerCase()})`
    : `the lead is marked ${RULE_LABEL[d.rule]}`;

/**
 * Two items that ask the same person to call the same business become one: the most pressing
 * reason leads (started > callback > opened > sent > no answer), it's due when the earliest one
 * was, and its words say what else is open for that business. The others' keys come back as
 * `absorbed` so the sync can take their rows away.
 */
export function mergeSameBusiness(
  items: Desired[],
  nameOf: (d: Desired) => string | null,
): { items: Desired[]; absorbed: string[] } {
  const groups = new Map<string, Desired[]>();
  const kept: Desired[] = [];
  for (const d of items) {
    const biz = CALL_RULES.includes(d.rule) ? businessKey(nameOf(d)) : "";
    if (!biz) {
      kept.push(d);
      continue;
    }
    const k = `${d.owner ?? "-"}|${biz}`;
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }
  const absorbed: string[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      kept.push(g[0]!);
      continue;
    }
    const sorted = [...g].sort(
      (a, b) =>
        CALL_RULES.indexOf(a.rule) - CALL_RULES.indexOf(b.rule) ||
        b.due_at.localeCompare(a.due_at) ||
        a.source_key.localeCompare(b.source_key),
    );
    const [lead, ...rest] = sorted as [Desired, ...Desired[]];
    const name = nameOf(lead)?.trim() || "this business";
    const due = g.map((d) => d.due_at).sort()[0]!;
    kept.push({
      ...lead,
      due_at: due,
      why: clip(
        `${lead.why} Also for ${name}: ${rest.map(alsoSay).join("; ")}. One call covers it.`,
        600,
      ),
    });
    absorbed.push(...rest.map((d) => d.source_key));
  }
  return { items: kept, absorbed };
}

function planEach(input: CalInput, now: Date): Desired[] {
  const t = now.getTime();
  const seatUser = new Map(
    input.seats.filter((s) => s.active && s.user_id).map((s) => [s.slug, s.user_id!]),
  );
  const ownerOf = (slug: string | null | undefined) => (slug ? (seatUser.get(slug) ?? null) : null);
  const staffUsers = new Set([...seatUser.values(), ...input.admins]);
  const files = new Map(input.files.map((f) => [f.id, f]));
  const leads = new Map(input.leads.map((l) => [l.id, l]));
  const bizOf = (f: CalFile | undefined) =>
    f?.business_name?.trim() || f?.first_name?.trim() || "A business";
  const openFile = (id: string) => {
    const f = files.get(id);
    return f && OPEN_FILE.has(f.status) ? f : undefined;
  };
  const out: Desired[] = [];
  const base = {
    application_id: null,
    lead_id: null,
    engine_lead_id: null,
    invite_id: null,
  };
  const iso = (x: number) => new Date(x).toISOString();

  // an admin asked a rep to call a file or a lead (file_notes)
  for (const c of input.calls) {
    const f = c.application_id ? files.get(c.application_id) : undefined;
    if (f && !OPEN_FILE.has(f.status)) continue;
    const lead = !f && c.lead_id ? leads.get(c.lead_id) : undefined;
    if (!f && !lead) continue;
    const who = f ? bizOf(f) : lead?.name?.trim() || "a lead";
    const dated = c.due_on && /^\d{4}-\d{2}-\d{2}$/.test(c.due_on);
    const day = dated ? c.due_on! : nyDay(ms(c.created_at));
    out.push({
      ...base,
      rule: "assigned_call",
      source_key: `call:${c.id}`,
      owner: ownerOf(c.assigned_to),
      rep_slug: c.assigned_to,
      title: `Call ${who}`,
      why:
        `${c.author_name?.trim() || "An admin"} asked you to call` +
        (dated
          ? ` by ${sayDay(dayAt(day))}`
          : ` on ${sayDay(ms(c.created_at))} (no date was set)`) +
        `: "${clip(c.body, 160)}". Log what happened on the ${f ? "file" : "lead"}.`,
      link: f ? fileLink(f.id) : `/staff?lead=${c.lead_id}`,
      due_at: iso(dayAt(day)),
      all_day: true,
      application_id: f ? f.id : null,
      lead_id: f ? null : c.lead_id,
    });
  }

  for (const l of input.engineLeads) {
    const owner = ownerOf(l.rep_slug);
    const name = l.name?.trim() || "A lead";
    // someone answered a Lamp email (email-replies.ts files it as an engine lead)
    if (l.source === "email-reply" && l.status === "new") {
      const reply = newestReply(l.signals);
      if (reply && reply.type === "email_reply") {
        const at = has(reply.at) ? ms(reply.at) : has(l.pushed_at) ? ms(l.pushed_at) : NaN;
        if (!Number.isNaN(at)) {
          out.push({
            ...base,
            rule: "email_reply",
            source_key: `reply:${l.id}:${reply.key ?? new Date(at).toISOString()}`,
            owner,
            rep_slug: l.rep_slug,
            title: `Answer ${name}`,
            why: `${name} replied to the Lamp email on ${sayDay(at)}. Answer while it's fresh, then set the lead's status.`,
            link: "/staff?view=replies",
            due_at: iso(at),
            all_day: false,
            engine_lead_id: l.id,
          });
        }
      }
      continue;
    }
    if (!l.rep_slug || !has(l.worked_at)) continue;
    const worked = ms(l.worked_at);
    if (l.status === "callback" && has(l.callback_at)) {
      // the rep picked when to call back: the item sits at that time, not on the next business day
      const at = ms(l.callback_at);
      if (t - at <= CALLBACK_WINDOW_DAYS * DAY) {
        const allDay = isDayOnly(l.callback_at!);
        out.push({
          ...base,
          rule: "lead_callback",
          // the picked time is part of the key: change it and the old item clears, a new one is made
          source_key: `callback:${l.id}:${l.worked_at}:${iso(at)}`,
          owner,
          rep_slug: l.rep_slug,
          title: `Call back ${name}`,
          why: `You set this callback for ${sayCallback(l.callback_at!)}. To change it, open the lead and pick a new time.`,
          link: engineLink(l.id),
          due_at: iso(at),
          all_day: allDay,
          engine_lead_id: l.id,
        });
      }
    } else if (l.status === "callback" && t - worked <= CALLBACK_WINDOW_DAYS * DAY) {
      out.push({
        ...base,
        rule: "lead_callback",
        source_key: `callback:${l.id}:${l.worked_at}`,
        owner,
        rep_slug: l.rep_slug,
        title: `Call back ${name}`,
        why: `Marked Callback on ${sayDay(worked)} with no day picked, so this is the next business day. Open the lead and pick the day and time they gave.`,
        link: engineLink(l.id),
        due_at: iso(dayAt(businessDay(worked, 1))),
        all_day: true,
        engine_lead_id: l.id,
      });
    } else if (l.status === "no_answer" && t - worked <= NO_ANSWER_WINDOW_DAYS * DAY) {
      out.push({
        ...base,
        rule: "lead_no_answer",
        source_key: `noanswer:${l.id}:${l.worked_at}`,
        owner,
        rep_slug: l.rep_slug,
        title: `Try ${name} again`,
        why: `No answer on ${sayDay(worked)}. Try again, then set the lead's status to what happened.`,
        link: engineLink(l.id),
        due_at: iso(dayAt(businessDay(worked, 1))),
        all_day: true,
        engine_lead_id: l.id,
      });
    }
  }

  // application links a rep sent (application_invites)
  for (const i of input.invites) {
    if (!has(i.sent_at) || i.cancelled_at || i.application_id || i.submitted_at) continue;
    if (ms(i.expires_at) < t) continue;
    const name =
      i.business_name?.trim() ||
      [i.first_name, i.last_name].filter(Boolean).join(" ").trim() ||
      "A business";
    const common = {
      ...base,
      owner: ownerOf(i.rep_slug),
      rep_slug: i.rep_slug,
      link: `/staff?view=sent&invite=${i.id}`,
      all_day: true,
      invite_id: i.id,
    };
    if (has(i.started_at)) {
      const last = Math.max(ms(i.started_at), has(i.draft_saved_at) ? ms(i.draft_saved_at) : 0);
      out.push({
        ...common,
        rule: "link_unfinished",
        source_key: `link:${i.id}:unfinished`,
        title: `Help ${name} finish`,
        why: `${name} started the application on ${sayDay(ms(i.started_at))} and hasn't submitted it. Call to help them finish.`,
        due_at: iso(dayAt(businessDay(last, UNFINISHED_DAYS))),
      });
    } else if (has(i.opened_at)) {
      out.push({
        ...common,
        rule: "link_unstarted",
        source_key: `link:${i.id}:unstarted`,
        title: `Follow up with ${name}`,
        why: `${name} opened the application link on ${sayDay(ms(i.opened_at))} and hasn't started. Call to walk them through it.`,
        due_at: iso(dayAt(businessDay(ms(i.opened_at), LINK_DAYS))),
      });
    } else {
      out.push({
        ...common,
        rule: "link_unopened",
        source_key: `link:${i.id}:unopened`,
        title: `Follow up with ${name}`,
        why: `The application link went out on ${sayDay(ms(i.sent_at))} and hasn't been opened. Call, or resend it.`,
        due_at: iso(dayAt(businessDay(ms(i.sent_at), LINK_DAYS))),
      });
    }
  }

  // an offer presented to the merchant with no answer yet
  for (const o of input.offers) {
    const f = openFile(o.application_id);
    if (!f || o.status !== "presented" || !has(o.presented_at)) continue;
    if (has(o.expires_at) && ms(o.expires_at) < t) continue;
    const from = o.funder?.trim() ? ` from ${o.funder.trim()}` : "";
    const expiry = has(o.expires_at) ? ms(o.expires_at) : NaN;
    const due = Number.isNaN(expiry)
      ? dayAt(businessDay(ms(o.presented_at), OFFER_DAYS))
      : Math.max(ms(o.presented_at), expiry - OFFER_EXPIRY_LEAD_HOURS * 3_600_000);
    out.push({
      ...base,
      rule: "offer_waiting",
      source_key: `offer:${o.id}`,
      owner: ownerOf(f.rep_slug),
      rep_slug: f.rep_slug,
      title: `Get an answer on ${bizOf(f)}'s offer`,
      why:
        `The offer${from} was presented on ${sayDay(ms(o.presented_at))} and has no answer` +
        (Number.isNaN(expiry) ? "." : `. It runs out on ${sayDay(expiry)}.`),
      link: fileLink(f.id),
      due_at: iso(due),
      all_day: Number.isNaN(expiry),
      application_id: f.id,
    });
  }

  // a package sent to a funder with no answer recorded
  for (const s of input.submissions) {
    const f = openFile(s.application_id);
    if (!f || s.status !== "submitted" || s.decided_at || !has(s.submitted_at)) continue;
    const by = s.submitted_by && staffUsers.has(s.submitted_by) ? s.submitted_by : null;
    const funder = s.funder?.trim() || "The funder";
    out.push({
      ...base,
      rule: "funder_silent",
      source_key: `submission:${s.id}`,
      owner: by ?? ownerOf(f.rep_slug),
      rep_slug: f.rep_slug,
      title: `Chase ${funder} on ${bizOf(f)}`,
      why: `${bizOf(f)} went to ${funder} on ${sayDay(ms(s.submitted_at))} and no answer is recorded. Ask for a decision, or record the one that came in.`,
      link: fileLink(f.id),
      due_at: iso(dayAt(businessDay(ms(s.submitted_at), FUNDER_DAYS))),
      all_day: true,
      application_id: f.id,
    });
  }

  // a documents link with nothing uploaded to it
  for (const r of input.docRequests) {
    const f = openFile(r.application_id);
    if (!f || r.closed_at || r.received > 0 || ms(r.expires_at) < t) continue;
    out.push({
      ...base,
      rule: "docs_missing",
      source_key: `docreq:${r.id}`,
      owner: ownerOf(f.rep_slug),
      rep_slug: f.rep_slug,
      title: `Chase documents from ${bizOf(f)}`,
      why: `You asked for "${clip(r.title, 60)}" on ${sayDay(ms(r.created_at))} and nothing has come in. Remind them; the link is on the file.`,
      link: fileLink(f.id),
      due_at: iso(dayAt(businessDay(ms(r.created_at), DOCS_DAYS))),
      all_day: true,
      application_id: f.id,
    });
  }

  // the engine's emails for a day, waiting for an admin (engine_outbox), one item per admin
  const today = nyDay(t);
  const oldest = shiftDay(today, -OUTBOX_WINDOW_DAYS);
  for (const b of input.outbox) {
    if (b.pending <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(b.batch_date)) continue;
    if (b.batch_date < oldest) continue;
    for (const admin of input.admins) {
      out.push({
        ...base,
        rule: "emails_to_approve",
        source_key: `outbox:${b.batch_date}:${admin}`,
        owner: admin,
        rep_slug: null,
        title: "Approve the engine's emails",
        why: `${plural(b.pending, "email")} for ${sayDay(nyAt(b.batch_date, 12))} ${b.pending === 1 ? "waits" : "wait"} for an admin. Nothing goes out until one is approved in Email engine.`,
        link: "/staff?view=autopilot",
        due_at: iso(nyAt(b.batch_date, APPROVE_AT.hour, APPROVE_AT.minute)),
        all_day: false,
      });
    }
  }

  return out;
}

/** The newest reply recorded in an engine lead's signals (email-replies.ts replySignal). */
export function newestReply(
  signals: unknown,
): { type: "email_reply" | "email_optout"; at: string | null; key: string | null } | null {
  if (!Array.isArray(signals)) return null;
  let best: { type: "email_reply" | "email_optout"; at: string | null; key: string | null } | null =
    null;
  for (const s of signals) {
    if (!s || typeof s !== "object") continue;
    const x = s as { signal_type?: unknown; signal_date?: unknown; message_id?: unknown };
    if (x.signal_type !== "email_reply" && x.signal_type !== "email_optout") continue;
    const at = typeof x.signal_date === "string" ? x.signal_date : null;
    if (best && (Number.isNaN(ms(at)) || ms(at) <= ms(best.at))) continue;
    best = {
      type: x.signal_type,
      at,
      key: typeof x.message_id === "string" && x.message_id ? x.message_id.slice(0, 120) : null,
    };
  }
  return best;
}

// ---------- matching the table to the plan ----------

export type Existing = {
  id: string;
  source_key: string;
  rule: string;
  owner: string | null;
  status: "open" | "done" | "cleared";
  title: string;
  why: string;
  link: string | null;
  rep_slug: string | null;
};

/** Whose items this run may clear: an admin's run covers everyone, a rep's only their own. */
export type SyncScope = { isAdmin: boolean; userId: string };

export type Plan = {
  insert: (Desired & { scheduled_at: string })[];
  update: { id: string; patch: Record<string, unknown> }[];
  /** rows of items now folded into another item for the same business (never done ones) */
  remove: string[];
};

/**
 * What to change so the table matches the plan. New items are added; an open item keeps its due
 * time (the person may have moved it) but follows its record's words and owner; an item whose
 * reason passed is cleared, and opens again if the reason comes back. Done items are left alone.
 * Only items of rules whose records were read (`loaded`) are ever cleared. An item folded into
 * another for the same business (`absorbed`) is taken away rather than cleared, unless it's done.
 */
export function reconcile(
  existing: Existing[],
  desired: Desired[],
  scope: SyncScope,
  loaded: Rule[],
  now: Date,
  absorbed: string[] = [],
): Plan {
  const plan: Plan = { insert: [], update: [], remove: [] };
  const folded = new Set(absorbed);
  const mine = (owner: string | null) => scope.isAdmin || owner === scope.userId;
  const wanted = desired.filter((d) => mine(d.owner));
  const byKey = new Map(existing.map((e) => [e.source_key, e]));
  const keys = new Set(wanted.map((d) => d.source_key));
  for (const d of wanted) {
    const e = byKey.get(d.source_key);
    if (!e) {
      plan.insert.push({ ...d, scheduled_at: d.due_at });
      continue;
    }
    if (e.status === "done") continue;
    const patch: Record<string, unknown> = {};
    if (e.owner !== d.owner) patch["owner"] = d.owner;
    if (e.title !== d.title) patch["title"] = d.title;
    if (e.why !== d.why) patch["why"] = d.why;
    if (e.link !== d.link) patch["link"] = d.link;
    if (e.rep_slug !== d.rep_slug) patch["rep_slug"] = d.rep_slug;
    if (e.status === "cleared") {
      patch["status"] = "open";
      patch["cleared_at"] = null;
    }
    if (Object.keys(patch).length) plan.update.push({ id: e.id, patch });
  }
  const read = new Set<string>(loaded);
  for (const e of existing) {
    if (folded.has(e.source_key) && !keys.has(e.source_key)) {
      if (e.status !== "done" && mine(e.owner)) plan.remove.push(e.id);
      continue;
    }
    if (e.status !== "open" || keys.has(e.source_key)) continue;
    if (!mine(e.owner) || !read.has(e.rule)) continue;
    plan.update.push({
      id: e.id,
      patch: { status: "cleared", cleared_at: now.toISOString() },
    });
  }
  return plan;
}

// ---------- the page ----------

export type CalItem = {
  id: string;
  owner: string | null;
  rule: string;
  title: string;
  why: string;
  link: string | null;
  rep_slug: string | null;
  due_at: string;
  all_day: boolean;
  scheduled_at: string;
  status: "open" | "done" | "cleared";
  done_at: string | null;
  cleared_at: string | null;
};

/** Overdue: an all-day item from an earlier day, or a timed one whose time has passed. */
/**
 * Open items due on a day before `today`. Day and Week show them above the current day or week,
 * so an item that slipped is never hidden behind the day it was due.
 */
export function earlierOpen<T extends Pick<CalItem, "status" | "due_at">>(
  items: T[],
  today: string,
): T[] {
  return items.filter((i) => i.status === "open" && nyDay(Date.parse(i.due_at)) < today);
}

export function isOverdue(i: Pick<CalItem, "due_at" | "all_day" | "status">, now: Date): boolean {
  if (i.status !== "open") return false;
  return i.all_day ? nyDay(ms(i.due_at)) < nyDay(now.getTime()) : ms(i.due_at) < now.getTime();
}

/** A moved item keeps its time of day on the new day (New York time). */
export function moveTo(dueAt: string, day: string): string {
  const p = wallParts(ms(dueAt));
  return new Date(nyAt(day, p.hour, p.minute)).toISOString();
}

/** The seven New York days of the week (Monday first) holding `day`. */
export function weekOf(day: string): string[] {
  const back = (weekday(day) + 6) % 7;
  const monday = shiftDay(day, -back);
  return Array.from({ length: 7 }, (_, n) => shiftDay(monday, n));
}

// ---------- the month grid (Asad, 2026-11-24: "can the calendar show up as an actual calendar") ----------

/** "2026-11" for a YYYY-MM-DD day. */
export const monthOf = (day: string) => day.slice(0, 7);

/**
 * The weeks (Monday first) that cover the month holding `day`: four to six rows of seven days,
 * with the neighbouring months' days filling the first and last rows.
 */
export function monthGrid(day: string): string[][] {
  const first = `${monthOf(day)}-01`;
  const weeks: string[][] = [];
  let week = weekOf(first);
  do {
    weeks.push(week);
    week = weekOf(shiftDay(week[6]!, 1));
  } while (monthOf(week[0]!) === monthOf(day));
  return weeks;
}

/** The same day of the month n months on, or that month's last day when it is shorter. */
export function shiftMonth(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d!, last));
  return first.toISOString().slice(0, 10);
}

/** "November 2026" for a YYYY-MM-DD day. */
export const sayMonth = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(`${monthOf(day)}-01T12:00:00Z`),
  );

/** What one day's square shows: its first few items in order, and how many more there are. */
export function daySquare<T>(items: readonly T[], max = 3): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** "9:00 AM" in New York time. */
export const sayTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

export const isRule = (v: unknown): v is Rule =>
  typeof v === "string" && (RULES as readonly string[]).includes(v);

// ---------- one item as a card (agent-run-card contract: tone, pill, next line, one main button) ----------

// ---------- calling from an item (Asad, 2026-11-24: "give me a direction in what to do with these
// or make it convenient if calling them is what you want me to do here") ----------

/** Items that are a phone call to an engine lead. */
export const CALL_ITEM_RULES: readonly string[] = ["lead_callback", "lead_no_answer"];

/** What to do with an open call item, step by step; null for every other item. */
export function callSteps(i: Pick<CalItem, "rule" | "status">): string | null {
  if (i.status !== "open") return null;
  if (i.rule === "lead_no_answer")
    return "Call them. If they pick up, open the lead and set what happened: this item then clears itself. No answer again: Mark done.";
  if (i.rule === "lead_callback")
    return "Call them. To call on another day, open the lead and pick the new time. After you talk, open the lead and set what happened: this item then clears itself.";
  return null;
}

/** The engine lead an item's link points at ("/staff?view=engine&elead=12"), or null. */
export function eleadOf(link: string | null): number | null {
  const m = /[?&]elead=(\d{1,12})(?:&|$)/.exec(link ?? "");
  return m ? Number(m[1]) : null;
}

/** The engine leads the open call items point at, each once: the numbers the page looks up. */
export function leadsToCall(items: readonly Pick<CalItem, "rule" | "status" | "link">[]): number[] {
  const ids = new Set<number>();
  for (const i of items) {
    if (i.status !== "open" || !CALL_ITEM_RULES.includes(i.rule)) continue;
    const id = eleadOf(i.link);
    if (id !== null) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

export type CallTo = {
  /** "+19087658526", for a tel: link */
  tel: string;
  /** "908-765-8526" */
  shown: string;
  /** the person to ask for, when the rep saved one */
  who: string | null;
};

const usTen = (raw: string | null | undefined): string | null => {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
};

/**
 * The number to call for a lead: the contact number the rep saved, else the business line. Null
 * when neither is a ten-digit US number, so the card never offers a call that can't connect.
 */
export function callTo(lead: {
  phone: string | null;
  contact_phone: string | null;
  contact_name: string | null;
}): CallTo | null {
  const own = usTen(lead.contact_phone);
  const d = own ?? usTen(lead.phone);
  if (!d) return null;
  return {
    tel: `+1${d}`,
    shown: `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
    who: own ? lead.contact_name?.trim() || null : null,
  };
}

export type CardTone = "working" | "attention" | "ready" | "done" | "failed";
export type ItemView = {
  tone: CardTone;
  pill: string;
  /** what this is and when: "Offer waiting · 9:00 AM" */
  subtitle: string;
  next: string;
  primary: { label: string; action: "done" } | null;
  canMove: boolean;
  canReopen: boolean;
};

/** Everything the card shows, worked out from the item alone, so it can't show a state the row doesn't support. */
export function itemView(
  i: CalItem,
  now: Date,
  state: { busy?: boolean; error?: string | null } = {},
): ItemView {
  const label = isRule(i.rule) ? RULE_LABEL[i.rule] : "Follow-up";
  const when = i.all_day ? "All day" : sayTime(i.due_at);
  const moved = i.scheduled_at !== i.due_at ? " · moved" : "";
  const subtitle = `${label} · ${when}${moved}`;
  if (i.status === "done")
    return {
      tone: "done",
      pill: "Done",
      subtitle,
      next: i.why,
      primary: null,
      canMove: false,
      canReopen: !state.busy,
    };
  if (i.status === "cleared")
    return {
      tone: "done",
      pill: "Cleared",
      subtitle,
      next: `${i.why} Cleared on its own: ${isRule(i.rule) ? RULE_CLEARS[i.rule] : "its reason passed"}.`,
      primary: null,
      canMove: false,
      canReopen: false,
    };
  const late = isOverdue(i, now);
  const today = nyDay(ms(i.due_at)) === nyDay(now.getTime());
  const tone: CardTone = state.busy
    ? "working"
    : state.error
      ? "failed"
      : late
        ? "attention"
        : "ready";
  return {
    tone,
    pill: state.busy
      ? "Saving"
      : state.error
        ? "Not saved"
        : late
          ? "Overdue"
          : today
            ? "Today"
            : "Coming up",
    subtitle,
    next: i.why,
    primary: { label: "Mark done", action: "done" },
    canMove: true,
    canReopen: false,
  };
}

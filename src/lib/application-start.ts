// What happens after someone gives their name, phone and email on the application's first screen
// (POST /api/application/start), kept free of the database and Gmail so it's unit-tested in
// tests/phone-start.test.ts. The rule: a contact the visitor typed always reaches the team.
// - The lead save is tried twice. If both fail, the rep (or, on the website, the copy list) still
//   gets the heads-up email, marked "Not saved in Lamp", so someone adds the person by hand. These
//   are the same people and the same details as a saved start, so no new data goes anywhere.
// - A rep link that has been switched off: the copy list is emailed instead of the rep.
// - Too many tries from one network (the per-network cap): only counted, never emailed, so the
//   cap still stops a flood.
// - A failed Gmail send is reported, not swallowed.
// Every failure is counted through fail(), with no name, email or phone in it.
// The browser half (postStart) is here too: it retries a start that never got an answer.
import { quickLines, type ChoiceKey } from "./apply.ts";
import { recipients, startedEmail, type StartedNote } from "./new-application-email.ts";

export type StartFailure =
  | "rate_limited"
  | "inactive_link"
  | "rep_lookup_failed"
  | "save_retried"
  | "save_failed"
  | "email_failed";

export type StartRep = { name: string; user_id: string | null; active: boolean };

export type Mail = { to: string; cc: string[]; subject: string; text: string };

/** "no_access": no mailbox or Google token; "gmail_<status>": Gmail said no; "threw": it threw. */
export type SendResult = { ok: true } | { ok: false; why: string };

export type StartInput = {
  /** The rep's slug, or "" for the website's own application. */
  rep: string;
  first: string;
  last: string;
  email: string;
  phone: string;
  businessName: string;
  textsOk: boolean;
  quick: Partial<Record<ChoiceKey, string>>;
};

export type StartDeps = {
  /** Names who gets every heads-up (NEW_APPLICATION_COPY). */
  copy: readonly string[];
  /** The rep row; error when the lookup itself failed (not when there's no such rep). */
  findRep(slug: string): Promise<{ rep: StartRep | null; error: boolean }>;
  /** The same email on the same link in the last 24 hours. */
  seenToday(): Promise<boolean>;
  /** False only when the per-network cap says no; a failed check lets the person through. */
  intakeAllowed(): Promise<boolean>;
  /** Saves the lead; true when it's saved. */
  insertLead(): Promise<boolean>;
  repEmail(userId: string): Promise<string | null>;
  send(mail: Mail): Promise<SendResult>;
  /** A progress token tied to the saved lead, or null. */
  progress(): Promise<string | null>;
  /** Counts a failure. Never given a name, email or phone. */
  fail(reason: StartFailure, detail?: string): void;
  /** Wait between the two save tries. */
  pause?(ms: number): Promise<void>;
};

export type StartReply = { status: number; body: Record<string, unknown> };

export const SAVE_RETRY_MS = 300;

export async function runStart(input: StartInput, deps: StartDeps): Promise<StartReply> {
  const website = input.rep === "";
  let rep: StartRep | null = null;
  let repName: string | null = null;
  if (!website) {
    const found = await deps.findRep(input.rep);
    if (found.error) {
      // the lookup failed, not the link: go on, so the person still reaches the team
      deps.fail("rep_lookup_failed");
      repName = input.rep;
    } else if (!found.rep) {
      return { status: 404, body: { error: "That link isn't active." } };
    } else if (!found.rep.active) {
      // a switched-off link: the copy list hears about it, within the per-network cap
      if (!(await deps.intakeAllowed())) return tooMany(deps);
      deps.fail("inactive_link");
      await notify(deps, input, { repName: found.rep.name, repEmail: null, note: "inactive_link" });
      return { status: 404, body: { error: "That link isn't active." } };
    } else {
      rep = found.rep;
      repName = found.rep.name;
    }
  }

  // the same person on the same link today: one lead, one heads-up
  if (await deps.seenToday())
    return { status: 200, body: { ok: true, progress: await deps.progress() } };

  if (!(await deps.intakeAllowed())) return tooMany(deps);

  let saved = await deps.insertLead();
  if (!saved) {
    deps.fail("save_retried");
    await deps.pause?.(SAVE_RETRY_MS);
    // a save whose answer was lost may have landed: don't make a second lead
    saved = (await deps.seenToday()) || (await deps.insertLead());
  }

  const repEmail = rep?.user_id ? await deps.repEmail(rep.user_id).catch(() => null) : null;
  if (!saved) {
    deps.fail("save_failed");
    const sent = await notify(deps, input, { repName, repEmail, note: "not_saved" });
    // the team has them by email, so the browser shouldn't send it again
    if (sent) return { status: 200, body: { ok: true, saved: false, progress: null } };
    return { status: 500, body: { error: "Couldn't save that. Try again." } };
  }
  await notify(deps, input, { repName, repEmail, note: null });
  return { status: 200, body: { ok: true, progress: await deps.progress() } };
}

function tooMany(deps: StartDeps): StartReply {
  deps.fail("rate_limited");
  return {
    status: 429,
    body: { error: "Too many tries from this network. Try again in an hour." },
  };
}

/** Sends the heads-up; true when Gmail took it. A failure is counted, never thrown. */
async function notify(
  deps: StartDeps,
  input: StartInput,
  how: { repName: string | null; repEmail: string | null; note: StartedNote | null },
): Promise<boolean> {
  const to = recipients(how.repEmail, deps.copy);
  if (!to) {
    deps.fail("email_failed", "no_recipients");
    return false;
  }
  const m = startedEmail({
    repName: how.repName,
    first: input.first,
    last: input.last,
    business: input.businessName,
    phone: input.phone,
    email: input.email,
    textsOk: input.textsOk,
    answered: quickLines(input.quick),
    ...(how.note ? { note: how.note } : {}),
  });
  let r: SendResult;
  try {
    r = await deps.send({ to: to.to, cc: to.cc, subject: m.subject, text: m.text });
  } catch {
    r = { ok: false, why: "threw" };
  }
  if (!r.ok) deps.fail("email_failed", r.why);
  return r.ok;
}

/** One log line per failure: the reason and a count, never who it was. */
export function startFailureLine(reason: StartFailure, count: number, detail?: string): string {
  return `application start: ${reason}${detail ? ` (${detail})` : ""}, ${count} since this server started`;
}

// ---------- the browser half ----------

export type StartAnswer =
  /** Saved; progress is the token to report stages with, or null when it couldn't be made. */
  | { kind: "saved"; progress: string | null }
  /** Not saved, but the team was emailed: don't send it again. */
  | { kind: "emailed" }
  /** A 400: something the person can fix. */
  | { kind: "problem"; error: string }
  /** An inactive link or the network cap: carry on, and don't send it again. */
  | { kind: "stopped" }
  /** Still no answer after the second try: carry on; a change to the contact boxes tries again. */
  | { kind: "failed" };

type Answer = { status: number; json(): Promise<unknown> };

/**
 * Sends the start, trying once more on a 5xx or a network error. Never retries a 400, 404 or 429:
 * those won't change, and a 429 would only use up another try.
 */
export async function postStart(
  send: () => Promise<Answer>,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<StartAnswer> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Answer;
    try {
      res = await send();
    } catch {
      if (attempt === 0) {
        await pause(1500);
        continue;
      }
      return { kind: "failed" };
    }
    if (res.status >= 500 && attempt === 0) {
      await pause(1500);
      continue;
    }
    const j = (await res.json().catch(() => null)) as {
      progress?: unknown;
      saved?: unknown;
      error?: unknown;
    } | null;
    if (res.status >= 200 && res.status < 300) {
      if (j?.saved === false) return { kind: "emailed" };
      return { kind: "saved", progress: typeof j?.progress === "string" ? j.progress : null };
    }
    if (res.status === 400)
      return {
        kind: "problem",
        error:
          typeof j?.error === "string" && j.error ? j.error : "Check the name, mobile and email.",
      };
    if (res.status >= 500) return { kind: "failed" };
    return { kind: "stopped" };
  }
  return { kind: "failed" };
}

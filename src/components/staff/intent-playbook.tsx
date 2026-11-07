import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";

/**
 * The intent playbook (Asad, 2026-11-07): the five levels of intent every merchant sits at, where
 * each lead source starts, and the clock a campaign follows, with UCC as the worked example. Reps
 * close at levels 4 and 5; everything below that is walking the merchant up one level per step.
 * Plain copy, no data: it sits at the top of the Training tab.
 */

type Level = { n: number; name: string; sounds: string; move: string };

const LEVELS: readonly Level[] = [
  {
    n: 1,
    name: "Unaware",
    sounds: "“We’re fine.” “What is this?” They don’t see a need, or don’t know this money exists.",
    move: "Find the need. “If you had an extra $50K this month, where would it go?” Don’t pitch yet.",
  },
  {
    n: 2,
    name: "Aware",
    sounds:
      "“I’ve done this before.” “Not right now.” They know the product, but they aren’t looking.",
    move: "Show how it works for them today: how fast it funds, how it’s paid back out of sales, what’s different from last time.",
  },
  {
    n: 3,
    name: "Researching",
    sounds: "“What are the rates like?” “How does it work?” They’re weighing it.",
    move: "“Let’s see what you’d qualify for.” Get the numbers: monthly deposits, time in business, any current balance.",
  },
  {
    n: 4,
    name: "Shopping",
    sounds: "“I’ve got another offer.” “Send me something.” They’re comparing.",
    move: "Get the bank statements and put a real offer in front of them fast. Speed beats the other broker.",
  },
  {
    n: 5,
    name: "Ready",
    sounds: "“How fast can I get it?” They want money now.",
    move: "Close: application signed, documents in, sent to funders the same day.",
  },
];

const SOURCES: readonly { source: string; level: string; why: string }[] = [
  {
    source: "UCC engine leads",
    level: "2",
    why: "They’ve taken an advance before, so they know the product. They didn’t ask to hear from us, and every broker has the same filing.",
  },
  {
    source: "Permit, license and contract leads",
    level: "1–2",
    why: "No funding history, but a real reason to call: a job is starting and money is going out first.",
  },
  {
    source: "Applications, Offer Check, referrals",
    level: "4–5",
    why: "They came to us. Call within 5 minutes.",
  },
];

const UCC_CLOCK: readonly { when: string; what: string }[] = [
  {
    when: "Day 0",
    what: "The funder files the UCC. The merchant just got money and every broker is calling. Don’t.",
  },
  {
    when: "Days 90–270",
    what: "The renewal window: about half paid down, deciding whether to renew, add or switch. The engine only sends you UCC leads in this window. Call now.",
  },
  {
    when: "After day 270",
    what: "Most have renewed or paid off. The lead goes back to the pool and comes round again at the next filing.",
  },
];

const CADENCE: readonly { when: string; what: string }[] = [
  { when: "Day 1", what: "Call twice: once in the morning, once late afternoon." },
  { when: "Days 2 and 4", what: "Call again. Leave one short voicemail, not one every time." },
  { when: "Days 7 and 14", what: "Last two calls. Send an email if you have one." },
  {
    when: "No answer by day 14",
    what: "Log it as no contact and let it go. It comes back at its next clock.",
  },
];

const OTHER_CLOCKS: readonly { source: string; clock: string }[] = [
  {
    source: "Applications and Offer Check",
    clock:
      "Starts at submit. Minutes matter: call within 5, three tries that day, offer within a day of the documents.",
  },
  {
    source: "Permits and contracts",
    clock:
      "Starts at the issue or award date. Call in the first two weeks, while the job is starting.",
  },
  { source: "UCC", clock: "Starts at the filing date. Wait for day 90, work it until day 270." },
];

const h2 = "font-display text-xl font-semibold";
const lead = "mt-1 text-sm text-smoke";

export function IntentPlaybook() {
  return (
    <section className="mt-8 space-y-10" data-intent-playbook>
      <div>
        <h2 className={h2}>The 5 levels of intent</h2>
        <p className={cn(lead, "max-w-3xl")}>
          Every merchant you call sits at one of five levels. You close at 4 and 5. Below that, your
          job is to find their level and move them up one step at a time. Pitch an offer to a level
          1 and you lose them.
        </p>
        <ol className="mt-4 grid gap-3 lg:grid-cols-5">
          {LEVELS.map((l) => (
            <li
              key={l.n}
              className={cn(card, "p-4", l.n >= 4 && "ring-2 ring-forest/40")}
              data-intent-level={l.n}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
                Level {l.n}
                {l.n >= 4 ? " · you close here" : ""}
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold">{l.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-smoke">{l.sounds}</p>
              {l.n < 5 ? (
                <p className="mt-3 text-sm leading-relaxed">
                  <span className="font-semibold">To level {l.n + 1}: </span>
                  {l.move}
                </p>
              ) : (
                <p className="mt-3 text-sm leading-relaxed">
                  <span className="font-semibold">Your move: </span>
                  {l.move}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h2 className={h2}>Where your leads start</h2>
        <p className={lead}>Know the level before you dial, so you open with the right step.</p>
        <ul className={cn(card, "mt-4 divide-y divide-line")}>
          {SOURCES.map((s) => (
            <li key={s.source} className="grid gap-1 p-4 sm:grid-cols-[14rem_5rem_1fr] sm:gap-4">
              <span className="font-semibold">{s.source}</span>
              <span className="text-sm text-smoke">Level {s.level}</span>
              <span className="text-sm leading-relaxed text-smoke">{s.why}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className={h2}>Every lead has a clock</h2>
        <p className={cn(lead, "max-w-3xl")}>
          A lead becomes a lead at a moment: a filing, a permit, an application. Its value runs from
          that moment. Follow the clock, not the list. UCC is the example; every source works the
          same way.
        </p>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className={cn(card, "p-5")}>
            <h3 className="font-display text-lg font-semibold">The UCC clock</h3>
            <ol className="mt-3 space-y-3">
              {UCC_CLOCK.map((s) => (
                <li key={s.when} className="text-sm leading-relaxed">
                  <span className="font-semibold">{s.when}: </span>
                  <span className="text-smoke">{s.what}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className={cn(card, "p-5")}>
            <h3 className="font-display text-lg font-semibold">Working a lead in its window</h3>
            <ol className="mt-3 space-y-3">
              {CADENCE.map((s) => (
                <li key={s.when} className="text-sm leading-relaxed">
                  <span className="font-semibold">{s.when}: </span>
                  <span className="text-smoke">{s.what}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-smoke">
              Log every try as a call note and set the date of the next one.
            </p>
          </div>
        </div>
        <ul className={cn(card, "mt-5 divide-y divide-line")}>
          {OTHER_CLOCKS.map((c) => (
            <li key={c.source} className="grid gap-1 p-4 sm:grid-cols-[14rem_1fr] sm:gap-4">
              <span className="font-semibold">{c.source}</span>
              <span className="text-sm leading-relaxed text-smoke">{c.clock}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={cn(card, "p-5")}>
        <h2 className="font-display text-lg font-semibold">Rules on every call</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-smoke">
          <li>Dial by hand. No auto-dialers.</li>
          <li>Only text merchants who applied or asked you to text them.</li>
          <li>If someone asks not to be called again, log it and stop.</li>
        </ul>
      </div>
    </section>
  );
}

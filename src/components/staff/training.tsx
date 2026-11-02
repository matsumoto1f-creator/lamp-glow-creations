import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";
import { clock, trainingFor, trainingSrc, type TrainingRole } from "@/lib/training";

/**
 * Training: the tutorial videos, by role. Reps get the rep series, admins get rep and admin, and
 * every staff member sees the merchant series to point merchants to (merchants see it on their
 * account page). Videos load only when played, so the tab costs nothing until someone watches.
 */

const HEAD: Record<TrainingRole, { title: string; note: string }> = {
  rep: { title: "For reps", note: "Watch these in order. About twelve minutes in all." },
  admin: { title: "For admins", note: "Running the team, the board, funders and money." },
  merchant: {
    title: "For merchants",
    note: "Merchants see these on their account page. Send one when a merchant asks how something works.",
  },
};

export function TrainingShelf({ role, heading = true }: { role: TrainingRole; heading?: boolean }) {
  const videos = trainingFor(role);
  return (
    <section className="mt-8" data-training={role}>
      {heading && (
        <>
          <h2 className="font-display text-xl font-semibold">{HEAD[role].title}</h2>
          <p className="mt-1 text-sm text-smoke">{HEAD[role].note}</p>
        </>
      )}
      <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {videos.map((v) => (
          <li key={v.slug} className={cn(card, "overflow-hidden")}>
            <video
              className="aspect-video w-full bg-black"
              controls
              playsInline
              preload="none"
              poster={trainingSrc(v.slug, "jpg")}
              src={trainingSrc(v.slug, "mp4")}
            >
              <track
                kind="captions"
                srcLang="en"
                label="English"
                src={trainingSrc(v.slug, "vtt")}
              />
            </video>
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
                Part {v.part} · {clock(v.sec)}
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold">{v.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-smoke">{v.about}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Training({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="mt-2">
      <TrainingShelf role="rep" />
      {isAdmin && <TrainingShelf role="admin" />}
      <TrainingShelf role="merchant" />
    </div>
  );
}

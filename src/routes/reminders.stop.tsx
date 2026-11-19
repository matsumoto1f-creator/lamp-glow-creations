import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import { PageShell, Eyebrow, btnPrimary } from "@/components/site/layout";
import { cn } from "@/lib/utils";
import { seo } from "@/lib/site";
import { parseStopToken } from "@/lib/finish-reminders";

// The stop link in a "finish your application" reminder: getlamp.app/reminders/stop?t=<token>.
// Nothing happens on opening it (mail scanners open links on their own); the button stops every
// reminder to that email, from any rep's link or the website.
export const Route = createFileRoute("/reminders/stop")({
  validateSearch: (s: Record<string, unknown>): { t?: string | undefined } => ({
    t: parseStopToken(s["t"]) ? (s["t"] as string) : undefined,
  }),
  head: () =>
    seo({
      path: "/reminders/stop",
      title: "Stop reminders — Lamp",
      description: "Stop Lamp's reminders to finish your application.",
      noindex: true,
    }),
  component: StopReminders,
});

function StopReminders() {
  const { t } = Route.useSearch();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function stop() {
    setState("busy");
    setError("");
    try {
      const res = await fetch("/api/application/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe", token: t }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "That didn't work. Try again in a moment.");
      setState("done");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "That didn't work. Try again in a moment.");
    }
  }

  return (
    <PageShell tone="night" minimalHeader footer={false}>
      <section className="mx-auto max-w-xl px-5 pb-24 pt-14 sm:px-6 sm:pt-20">
        <Eyebrow>Reminders</Eyebrow>
        {!t ? (
          <>
            <h1 className="mt-5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              That link isn't complete.
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-smoke">
              Open the stop link from the email again, or reply "stop" to the email and we'll stop
              the reminders for you.
            </p>
          </>
        ) : state === "done" ? (
          <>
            <h1 className="mt-5 flex items-center gap-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              <Check className="size-8 shrink-0 text-leaf" aria-hidden="true" /> Done. No more
              reminders.
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-smoke">
              We won't email you about finishing your application again. If you change your mind,
              your application link still works.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Stop reminders about your application?
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-smoke">
              We'll stop emailing you about finishing your Lamp application. Nothing else changes.
            </p>
            {error && (
              <p className="mt-5 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => void stop()}
              disabled={state === "busy"}
              className={cn(btnPrimary, "mt-8")}
            >
              {state === "busy" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Stop reminders
            </button>
          </>
        )}
      </section>
    </PageShell>
  );
}

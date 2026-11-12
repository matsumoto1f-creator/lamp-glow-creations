import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { postAsMe } from "@/lib/server-api";
import { seo } from "@/lib/site";
import { btnPrimary, card, PageShell } from "@/components/site/layout";

// Where /lamp link in Discord sends a rep: signed in to Lamp, this puts their Discord account on
// their login so their alerts come to their Discord DMs. The token in the link is signed by Lamp
// and works for 30 minutes.
export const Route = createFileRoute("/discord-link")({
  validateSearch: (s: Record<string, unknown>): { t?: string | undefined } => ({
    t: typeof s["t"] === "string" ? s["t"].slice(0, 200) : undefined,
  }),
  head: () =>
    seo({
      path: "/discord-link",
      title: "Connect Discord — Lamp",
      description: "Connect your Discord to your Lamp login.",
      noindex: true,
    }),
  component: DiscordLink,
});

function DiscordLink() {
  const { t } = Route.useSearch();
  const { user, loading } = useAuth();
  const [state, setState] = useState<"idle" | "busy" | "done" | { error: string }>("idle");

  useEffect(() => {
    if (loading || !user || !t || state !== "idle") return;
    setState("busy");
    postAsMe<{ linked: boolean }>("/api/discord/link", { token: t })
      .then((r) => setState(r.ok ? "done" : { error: r.data.error ?? "Couldn't connect." }))
      .catch((e: unknown) =>
        setState({ error: e instanceof Error ? e.message : "Couldn't connect." }),
      );
  }, [loading, user, t, state]);

  return (
    <PageShell member tone="night-calm" footer={false}>
      <div className="mx-auto max-w-md px-5 py-24">
        <div className={`${card} p-8 text-center`}>
          <h1 className="font-display text-2xl font-bold">Connect Discord</h1>
          {!t ? (
            <p className="mt-3 text-smoke">
              Type /lamp link in Lamp&apos;s Discord to get your link.
            </p>
          ) : loading || state === "busy" || (user && state === "idle") ? (
            <Loader2 className="mx-auto mt-6 size-6 animate-spin text-smoke" />
          ) : !user ? (
            <>
              <p className="mt-3 text-smoke">
                Sign in to Lamp in this browser, then open the link from Discord again.
              </p>
              <Link to="/login" className={`${btnPrimary} mt-6`}>
                Sign in
              </Link>
            </>
          ) : state === "done" ? (
            <p className="mt-4 flex items-center justify-center gap-2" data-discord-linked>
              <Check className="size-5 text-leaf" /> Connected. Your Lamp alerts now come to your
              Discord DMs, and /lamp knows who you are.
            </p>
          ) : typeof state === "object" ? (
            <p className="mt-4 text-destructive">{state.error}</p>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

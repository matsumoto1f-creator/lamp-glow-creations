import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";
import { chip } from "@/components/staff/field-styles";
import { AiKeyCard } from "@/components/staff/ai-key-card";
import {
  AI_KIND_COUNT_LABEL,
  AI_KIND_LABEL,
  AI_KINDS,
  BUDGET_LABEL,
  budgetView,
  OFF_LINE,
  usd,
  type AiUse,
} from "@/lib/ai-activity";
import type { AiActivity as Data } from "@/lib/ai-activity.server";

/**
 * AI activity (admins only): what Claude did in Lamp and what it cost. Two budgets (the statement
 * reader; the Today list and follow-up drafts), each with whether it is running and how much of
 * the month's limit is gone, then every time Claude was used: when, what for, for whom, on which
 * file, whether it worked, and the cost. It reads Lamp's own logs through /api/ai/activity and
 * changes nothing.
 */
async function load(): Promise<Data> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const r = await fetch("/api/ai/activity", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const j = (await r.json().catch(() => ({}))) as Data & { error?: string };
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const BUDGET_NOTE = {
  ok: "Claude stops for the month when this runs out. Lamp keeps working on its own rules.",
  near: "Nearly used up. Claude stops for the month when it runs out.",
  used: "Used up. Claude has stopped until the 1st; Lamp is working on its own rules.",
} as const;

const RESULT_LABEL = { worked: "Worked", failed: "Failed", working: "In progress" } as const;

export function AiActivity() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await load());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load AI activity.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="mt-6" data-ai-activity>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Sparkles className="size-4 text-forest" /> What Claude did this month
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-smoke">
            Each time Claude was used in Lamp, and what it cost. Claude reads statements and writes
            wording. Lamp&apos;s own code does the math and decides which funders fit.
          </p>
        </div>
        <button
          type="button"
          className={cn(chip, "min-h-11 gap-2 px-4")}
          onClick={() => void refresh()}
          disabled={busy}
          data-ai-refresh
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-sm" role="alert" data-ai-error>
          {error}
        </p>
      )}

      {!data && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-smoke">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}

      {data && (
        <>
          <AiKeyCard
            info={data.key}
            onChanged={(key) => {
              setData((d) => (d ? { ...d, key } : d));
              // the two cards below say On or Off from the same key
              void refresh();
            }}
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {data.budgets.map((b) => {
              const v = budgetView(b.spent, b.cap);
              return (
                <div key={b.key} className={cn(card, "p-5")} data-ai-budget={b.key}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold">{BUDGET_LABEL[b.key]}</h3>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        b.off ? "bg-sand text-ink" : "bg-leaf/20 text-forest",
                      )}
                      data-ai-switch={b.off ? "off" : "on"}
                    >
                      {b.off ? "Off" : "On"}
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-bold tabular-nums">
                    {usd(b.spent)}
                    <span className="text-sm font-normal text-smoke">
                      {" "}
                      of ${b.cap.toFixed(0)} this month
                    </span>
                  </p>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-sand"
                    role="progressbar"
                    aria-label={`${BUDGET_LABEL[b.key]}: share of this month's limit used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(v.fill * 100)}
                  >
                    <div
                      className={cn("h-full rounded-full", v.state === "ok" ? "bg-leaf" : "bg-ink")}
                      style={{ width: `${Math.max(v.fill * 100, b.spent > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm text-smoke" data-ai-budget-note>
                    {b.off ? OFF_LINE[b.off] : BUDGET_NOTE[v.state]}
                  </p>
                </div>
              );
            })}
          </div>

          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {AI_KINDS.map((k) => {
              const c = data.month.byKind[k];
              return (
                <div key={k} className={cn(card, "p-4")} data-ai-count={k}>
                  <dt className="text-sm text-smoke">{AI_KIND_COUNT_LABEL[k]}</dt>
                  <dd className="mt-1 text-xl font-bold tabular-nums">
                    {c.uses}
                    <span className="text-sm font-normal text-smoke">
                      {" "}
                      {c.uses === 1 ? "time" : "times"} · {usd(c.cost)}
                    </span>
                  </dd>
                  {c.failed > 0 && <dd className="mt-1 text-sm">{c.failed} failed</dd>}
                </div>
              );
            })}
          </dl>

          <div className={cn(card, "mt-4 p-5")}>
            <h3 className="font-display text-base font-semibold">Each time Claude was used</h3>
            {data.uses.length === 0 ? (
              <p className="mt-3 text-sm text-smoke" data-ai-empty>
                Nothing yet. A line appears here each time Claude reads a statement, writes a Today
                list, or writes a follow-up draft.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line" data-ai-uses>
                {data.uses.map((u) => (
                  <UseRow key={u.id} u={u} />
                ))}
              </ul>
            )}
            {data.uses.length > 0 && (
              <p className="mt-3 text-xs text-smoke">
                The latest {data.uses.length}, newest first, from this month and last.
                {data.truncated ? " Older ones are in the totals above only up to a limit." : ""}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function UseRow({ u }: { u: AiUse }) {
  return (
    <li
      className="grid gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[9rem_1fr_auto]"
      data-ai-use={u.kind}
      data-ai-result={u.result}
    >
      <span className="text-smoke tabular-nums">{when(u.at)}</span>
      <div className="min-w-0">
        <p className="font-medium">
          {AI_KIND_LABEL[u.kind]}
          {u.business && (
            <>
              {" · "}
              {u.file_id ? (
                <Link
                  to="/staff"
                  search={{ file: u.file_id }}
                  className="underline underline-offset-2"
                >
                  {u.business}
                </Link>
              ) : (
                u.business
              )}
            </>
          )}
        </p>
        <p className="break-words text-smoke">
          {[u.who ? `For ${u.who}` : null, u.result === "failed" ? u.error : u.detail]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            u.result === "worked" ? "bg-leaf/20 text-forest" : "bg-sand text-ink",
          )}
        >
          {RESULT_LABEL[u.result]}
        </span>
        <span className="w-20 text-right tabular-nums">{usd(u.cost)}</span>
      </div>
    </li>
  );
}

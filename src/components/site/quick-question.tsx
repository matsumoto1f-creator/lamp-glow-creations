import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChoiceQuestion } from "@/lib/apply";

/**
 * One quick question, one tap per answer: the front page's apply flow and the online
 * application's first screens both use it.
 */
export function QuickQuestion({
  q,
  value,
  onChoose,
}: {
  q: ChoiceQuestion;
  value: string | undefined;
  onChoose: (id: string) => void;
}) {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{q.title}</h1>
      {q.subtitle && <p className="mt-3 text-lg text-smoke">{q.subtitle}</p>}
      <div className="mt-8 grid gap-3" role="radiogroup" aria-label={q.title}>
        {q.options.map((o) => {
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChoose(o.id)}
              className={cn(
                "flex items-center justify-between rounded-2xl px-5 py-4 text-left text-[1.05rem] font-semibold transition",
                selected
                  ? "bg-leaf/15 ring-2 ring-leaf"
                  : "bg-white ring-1 ring-line hover:ring-ink/30",
              )}
            >
              {o.label}
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full ring-1",
                  selected ? "bg-leaf text-ink ring-leaf" : "ring-line",
                )}
              >
                {selected && <Check className="size-4" />}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { addRecent, EMOJI_GROUPS, readRecent, RECENT_KEY } from "@/lib/emoji";

/**
 * The emoji button beside the message box. It opens a small panel above the box: the ones this
 * person used lately, then faces, hands, work and money, and signs. Picking one hands it to the
 * message box (onPick), which puts it where the cursor is; the panel stays open for a second one.
 * Escape or a click outside closes it. The recent row is remembered in this browser only.
 */
export function EmojiPicker({
  onPick,
  disabled,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement | null>(null);

  // read after the first render, so the server's page and the browser's match
  useEffect(() => {
    try {
      setRecent(readRecent(window.localStorage.getItem(RECENT_KEY)));
    } catch {
      /* storage blocked: no recent row, the picker still works */
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (emoji: string) => {
    onPick(emoji);
    setRecent((r) => {
      const next = addRecent(r, emoji);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* not remembered, still inserted */
      }
      return next;
    });
  };

  const groups = [
    ...(recent.length ? [{ id: "recent", label: "Recent", emojis: recent }] : []),
    ...EMOJI_GROUPS,
  ];

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        className={cn(
          "grid size-11 place-items-center rounded-full ring-1 ring-line hover:bg-sand/60",
          open && "bg-sand/60",
        )}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Add an emoji"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-emoji-open
      >
        <Smile className="size-5" />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-40 mb-2 max-h-72 w-[min(19rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-night p-3 shadow-xl"
          role="dialog"
          aria-label="Emojis"
          data-emoji-panel
        >
          {groups.map((g) => (
            <section key={g.id} className="mb-2 last:mb-0" data-emoji-group={g.id}>
              <h4 className="px-1 pb-1 text-xs font-semibold text-smoke">{g.label}</h4>
              <div className="grid grid-cols-7 gap-0.5">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="grid size-10 place-items-center rounded-lg text-xl leading-none hover:bg-sand/60 focus-visible:bg-sand/60"
                    onClick={() => pick(e)}
                    aria-label={`Add ${e}`}
                    data-emoji={e}
                  >
                    <span aria-hidden>{e}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Smile, SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { addRecent, EMOJI_GROUPS, readRecent, RECENT_KEY } from "@/lib/emoji";

const PANEL_W = 304; // 19rem
const PANEL_H = 288; // max-h-72
const EDGE = 12;

/**
 * The emoji button beside the message box. It opens a small panel above the box: the ones this
 * person used lately, then faces, hands, work and money, and signs. Picking one hands it to the
 * message box (onPick), which puts it where the cursor is; the panel stays open for a second one.
 * Escape or a click outside closes it. The recent row is remembered in this browser only.
 *
 * variant "react" is the same panel on a message, for reacting to it: a smaller button, a first row
 * of quick picks, and it closes after one pick.
 */
export function EmojiPicker({
  onPick,
  disabled,
  variant = "compose",
  quick,
  align = "left",
  label,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean | undefined;
  variant?: "compose" | "react";
  /** shown first, under "Quick" (reactions) */
  quick?: readonly string[];
  /** which edge of the button the panel lines up with */
  align?: "left" | "right";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement | null>(null);
  // "react": the panel is placed on the screen itself, below the button when there's room and
  // above it when there isn't, because a message can sit anywhere in a scrolling list
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);

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
    // the list moved under a panel pinned to the screen: close it, don't let it drift
    const moved = (e: Event) => {
      if (variant === "react" && !(e.target instanceof Node && box.current?.contains(e.target)))
        setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open, variant]);

  const toggle = () => {
    if (!open && variant === "react" && box.current) {
      const r = box.current.getBoundingClientRect();
      const w = Math.min(PANEL_W, window.innerWidth - 2 * EDGE);
      const h = Math.min(PANEL_H, window.innerHeight - 2 * EDGE);
      const below = r.bottom + 8 + h <= window.innerHeight - EDGE;
      const top = below ? r.bottom + 8 : Math.max(EDGE, r.top - 8 - h);
      const want = align === "right" ? r.right - w : r.left;
      setSpot({ top, left: Math.max(EDGE, Math.min(want, window.innerWidth - w - EDGE)) });
    }
    setOpen((o) => !o);
  };

  const pick = (emoji: string) => {
    onPick(emoji);
    if (variant === "react") setOpen(false);
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
    ...(quick?.length ? [{ id: "quick", label: "Quick", emojis: quick }] : []),
    ...(recent.length ? [{ id: "recent", label: "Recent", emojis: recent }] : []),
    ...EMOJI_GROUPS,
  ];

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        className={cn(
          "grid place-items-center rounded-full ring-1 ring-line hover:bg-sand/60",
          variant === "react" ? "size-8 text-smoke" : "size-11",
          open && "bg-sand/60",
        )}
        onClick={toggle}
        disabled={disabled}
        aria-label={label ?? (variant === "react" ? "React with an emoji" : "Add an emoji")}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-emoji-open={variant}
      >
        {variant === "react" ? <SmilePlus className="size-4" /> : <Smile className="size-5" />}
      </button>

      {open && (
        <div
          className={cn(
            "max-h-72 w-[min(19rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-night p-3 shadow-xl",
            variant === "react"
              ? "fixed z-[60]"
              : cn("absolute bottom-full z-40 mb-2", align === "right" ? "right-0" : "left-0"),
          )}
          style={variant === "react" && spot ? { top: spot.top, left: spot.left } : undefined}
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

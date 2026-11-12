import { cn } from "@/lib/utils";
import { QUICK_REACTIONS, reactionLabel, type ReactionChip } from "@/lib/reactions";
import { EmojiPicker } from "@/components/chat/emoji-picker";

/**
 * The reactions under one message: a chip per emoji with how many people used it (the reader's own
 * are outlined), and a small button to add one. Tapping a chip puts the reader's reaction on or
 * takes it off. The thread does the saving (onToggle).
 */
export function MessageReactions({
  chips,
  mine,
  disabled,
  onToggle,
}: {
  chips: readonly ReactionChip[];
  /** the reader's own message: the row hugs the right edge */
  mine: boolean;
  disabled?: boolean | undefined;
  onToggle: (emoji: string) => void;
}) {
  return (
    <div
      className={cn(
        "mt-1 flex flex-wrap items-center gap-1",
        mine ? "justify-end" : "justify-start",
      )}
      data-reactions
    >
      {chips.map((c) => (
        <button
          key={c.emoji}
          type="button"
          className={cn(
            "flex h-8 items-center gap-1 rounded-full px-2 text-sm ring-1",
            c.mine ? "bg-leaf/20 ring-leaf" : "bg-white ring-line hover:bg-sand/60",
          )}
          onClick={() => onToggle(c.emoji)}
          disabled={disabled}
          aria-pressed={c.mine}
          aria-label={reactionLabel(c)}
          data-reaction={c.emoji}
          data-reaction-mine={c.mine ? "yes" : "no"}
        >
          <span aria-hidden>{c.emoji}</span>
          <span className="text-xs font-semibold tabular-nums">{c.count}</span>
        </button>
      ))}
      <EmojiPicker
        variant="react"
        quick={QUICK_REACTIONS}
        align={mine ? "right" : "left"}
        onPick={onToggle}
        disabled={disabled}
      />
    </div>
  );
}

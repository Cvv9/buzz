import { cn } from "@/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { ReactionSummary } from "../workspace-api";

type ReactionPillProps = {
  reaction: ReactionSummary;
  ownPubkey: string;
  actorName: (pubkey: string) => string;
  onToggle: (emoji: string) => void;
};

/**
 * A reaction stays actionable while revealing who participated without making
 * the message timeline visually heavier.
 */
export function ReactionPill({
  reaction,
  ownPubkey,
  actorName,
  onToggle,
}: ReactionPillProps) {
  const ownReaction = reaction.authors.includes(ownPubkey);
  const names = reaction.authors.map(actorName);
  const reactedBy = names.join(", ");
  const action = ownReaction ? "remove your reaction" : "add your reaction";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={`${reaction.emoji} reaction from ${reactedBy}; click to ${action}`}
          className={cn(
            "rounded-lg border px-2 py-0.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b6b71e]/70",
            ownReaction
              ? "border-[#b6b71e] bg-[#d7d72e]/20 hover:bg-[#d7d72e]/30"
              : "border-black/10 bg-black/[0.025] hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]",
          )}
          type="button"
          onClick={() => onToggle(reaction.emoji)}
        >
          {reaction.emoji} {reaction.authors.length}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Reacted by {reactedBy}</TooltipContent>
    </Tooltip>
  );
}

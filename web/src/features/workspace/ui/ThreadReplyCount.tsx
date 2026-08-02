import * as React from "react";

const DOUBLE_CLICK_DELAY_MS = 220;

type ThreadReplyCountProps = {
  expanded: boolean;
  messageId: string;
  replyCount: number;
  onOpenPanel: () => void;
  onToggleInline: () => void;
};

/**
 * A reply count has two intentional actions: expand the thread in context, or
 * open the focused thread panel. Deferring the single-click action prevents a
 * double-click from briefly expanding the timeline before opening the panel.
 */
export function ThreadReplyCount({
  expanded,
  messageId,
  replyCount,
  onOpenPanel,
  onToggleInline,
}: ThreadReplyCountProps) {
  const clickTimeoutRef = React.useRef<number | null>(null);

  const cancelPendingClick = React.useCallback(() => {
    if (clickTimeoutRef.current === null) return;
    window.clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = null;
  }, []);

  React.useEffect(() => cancelPendingClick, [cancelPendingClick]);

  return (
    <button
      aria-controls={`inline-thread-${messageId}`}
      aria-expanded={expanded}
      className="ml-1 text-xs font-medium text-[#777800] hover:underline dark:text-[#d7d72e]"
      data-testid={`thread-reply-count-${messageId}`}
      title="Click to expand replies here. Double-click to open the thread panel."
      type="button"
      onClick={() => {
        cancelPendingClick();
        clickTimeoutRef.current = window.setTimeout(() => {
          clickTimeoutRef.current = null;
          onToggleInline();
        }, DOUBLE_CLICK_DELAY_MS);
      }}
      onDoubleClick={() => {
        cancelPendingClick();
        onOpenPanel();
      }}
    >
      {replyCount} {replyCount === 1 ? "reply" : "replies"}
    </button>
  );
}

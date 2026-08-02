import { Send, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import type {
  WorkspaceChannel,
  WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import type { TimelineMessage } from "../workspace-messages";

type WorkspaceComposerProps = {
  agents: WorkspaceProfile[];
  channel: WorkspaceChannel;
  compact?: boolean;
  replyTo?: TimelineMessage;
  sending: boolean;
  onCancelReply?: () => void;
  onSend: (content: string, mentions: string[]) => void;
};

export function WorkspaceComposer({
  channel,
  agents,
  replyTo,
  onCancelReply,
  onSend,
  sending,
  compact = false,
}: WorkspaceComposerProps) {
  const [content, setContent] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    const lowered = trimmed.toLocaleLowerCase();
    const mentions = agents
      .filter((agent) =>
        [agent.name, ...(agent.aliases ?? [])].some((name) =>
          lowered.includes(`@${name.toLocaleLowerCase()}`),
        ),
      )
      .map((agent) => agent.pubkey);
    onSend(trimmed, mentions);
    setContent("");
  };

  return (
    <div
      className={cn(
        "shrink-0 px-4 pb-4 pt-2 sm:px-6 sm:pb-5",
        compact && "px-0 pb-2 pt-2 sm:px-0 sm:pb-2",
      )}
    >
      <div className="overflow-hidden rounded-2xl border border-black/12 bg-white shadow-[0_8px_28px_rgba(30,33,25,0.06)] focus-within:border-[#b6b71e] dark:border-white/12 dark:bg-[#20231e] dark:shadow-none">
        {replyTo ? (
          <div className="flex items-center justify-between border-b border-black/8 bg-black/[0.025] px-4 py-2 text-xs dark:border-white/8 dark:bg-white/[0.025]">
            <span className="truncate text-black/55 dark:text-white/50">
              Replying in thread
            </span>
            <button
              aria-label="Cancel reply"
              className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
              type="button"
              onClick={onCancelReply}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
        <textarea
          aria-label={`Message ${channel.name}`}
          className={cn(
            "block max-h-40 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-black/35 dark:placeholder:text-white/30",
            compact ? "min-h-12" : "min-h-16",
          )}
          placeholder={
            agents.length
              ? `Message #${channel.name}, or @mention an agent`
              : `Message #${channel.name}`
          }
          ref={textareaRef}
          rows={compact ? 1 : 2}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <p className="text-[0.6875rem] text-black/30 dark:text-white/25">
            Enter to send · Shift + Enter for a new line
          </p>
          <Button
            aria-label="Send message"
            className="size-8 bg-[#d7d72e] p-0 text-[#171912] hover:bg-[#e5e54d]"
            disabled={!content.trim() || sending}
            type="button"
            onClick={submit}
          >
            <Send className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

import { ClipboardPaste, Paperclip, Send, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { readClipboardMediaFiles } from "@/features/media/browser-media";
import {
  buildCustomEmojiTags,
  type CustomEmoji,
} from "@/features/custom-emoji/custom-emoji-policy";
import { CustomEmojiPickerButton } from "@/features/custom-emoji/ui/CustomEmojiPickerButton";
import { buildOutgoingMediaMessage } from "@/features/media/media-policy";
import { ComposerAttachments } from "@/features/media/ui/ComposerAttachments";
import { useComposerAttachments } from "@/features/media/useComposerAttachments";
import {
  readLocalChannelDrafts,
  writeLocalChannelDrafts,
} from "@/features/channel-state/channel-state-api";
import { draftContextId } from "@/features/channel-state/channel-state-policy";
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
  customEmoji: readonly CustomEmoji[];
  compact?: boolean;
  draftPubkey: string;
  replyTo?: TimelineMessage;
  sending: boolean;
  onCancelReply?: () => void;
  onTyping?: () => void;
  onSend: (content: string, mentions: string[], mediaTags?: string[][]) => void;
};

export function WorkspaceComposer({
  channel,
  customEmoji,
  draftPubkey,
  agents,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
  sending,
  compact = false,
}: WorkspaceComposerProps) {
  const [content, setContent] = React.useState("");
  const draftKey = draftContextId(
    channel.id,
    replyTo?.rootEventId ?? replyTo?.id,
  );
  const [restoredDraftKey, setRestoredDraftKey] = React.useState<string | null>(
    null,
  );
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const {
    addFiles,
    attachments,
    clear,
    hasFailed,
    hasUploading,
    readyAttachments,
    remove,
    retry,
  } = useComposerAttachments();
  React.useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);
  React.useEffect(() => {
    setContent(
      readLocalChannelDrafts(draftPubkey).drafts[draftKey]?.content ?? "",
    );
    setRestoredDraftKey(draftKey);
  }, [draftKey, draftPubkey]);
  React.useEffect(() => {
    if (restoredDraftKey !== draftKey) return;
    const store = readLocalChannelDrafts(draftPubkey);
    const drafts = { ...store.drafts };
    if (content) drafts[draftKey] = { content, updatedAt: Date.now() };
    else delete drafts[draftKey];
    writeLocalChannelDrafts(draftPubkey, { version: 1, drafts });
  }, [content, draftKey, draftPubkey, restoredDraftKey]);

  const acceptFiles = React.useCallback(
    (files: Iterable<File>) => {
      const errors = addFiles(files);
      if (errors.length) {
        toast.error("Some attachments were not added", {
          description: errors.join(" "),
        });
      }
    },
    [addFiles],
  );

  const submit = () => {
    const trimmed = content.trim();
    if (sending || hasUploading) return;
    if (hasFailed) {
      toast.error("Resolve failed attachments before sending.");
      return;
    }
    if (!trimmed && readyAttachments.length === 0) return;
    const lowered = trimmed.toLocaleLowerCase();
    const mentions = agents
      .filter((agent) =>
        [agent.name, ...(agent.aliases ?? [])].some((name) =>
          lowered.includes(`@${name.toLocaleLowerCase()}`),
        ),
      )
      .map((agent) => agent.pubkey);
    const outgoing = buildOutgoingMediaMessage(trimmed, readyAttachments);
    onSend(outgoing.content, mentions, [
      ...(outgoing.mediaTags ?? []),
      ...buildCustomEmojiTags(outgoing.content, customEmoji),
    ]);
    setContent("");
    clear();
  };

  const insertCustomEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? content.length;
    const end = textarea?.selectionEnd ?? content.length;
    const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`;
    setContent(next);
    onTyping?.();
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  return (
    <div
      className={cn(
        "shrink-0 px-4 pb-4 pt-2 sm:px-6 sm:pb-5",
        compact && "px-0 pb-2 pt-2 sm:px-0 sm:pb-2",
      )}
    >
      <fieldset
        aria-label="Message composer"
        className={cn(
          "overflow-visible rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary",
          draggingFiles && "border-primary ring-2 ring-primary/20",
        )}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            setDraggingFiles(true);
        }}
        onDragLeave={() => setDraggingFiles(false)}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingFiles(false);
          acceptFiles(event.dataTransfer.files);
        }}
      >
        {replyTo ? (
          <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2 text-xs">
            <span className="truncate text-muted-foreground">
              Replying in thread
            </span>
            <button
              aria-label="Cancel reply"
              className="rounded p-1 hover:bg-accent hover:text-accent-foreground"
              type="button"
              onClick={onCancelReply}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
        <ComposerAttachments
          attachments={attachments}
          onRemove={remove}
          onRetry={retry}
        />
        <input
          className="sr-only"
          multiple
          ref={fileInputRef}
          type="file"
          onChange={(event) => {
            acceptFiles(event.target.files ?? []);
            event.target.value = "";
          }}
        />
        <textarea
          aria-label={`Message ${channel.name}`}
          className={cn(
            "block max-h-40 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground",
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
          onChange={(event) => {
            setContent(event.target.value);
            onTyping?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={(event) => {
            if (event.clipboardData.files.length === 0) return;
            event.preventDefault();
            acceptFiles(event.clipboardData.files);
          }}
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <p className="text-[0.6875rem] text-muted-foreground">
            Enter to send · Shift + Enter for a new line
          </p>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Attach files"
              size="icon"
              type="button"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-3.5" />
            </Button>
            <Button
              aria-label="Paste image from clipboard"
              size="icon"
              type="button"
              variant="ghost"
              onClick={() => {
                void readClipboardMediaFiles()
                  .then((files) => {
                    if (files.length === 0) {
                      toast.message(
                        "No image or MP4 video was found in the clipboard.",
                      );
                      return;
                    }
                    acceptFiles(files);
                  })
                  .catch((error) => {
                    toast.error("Clipboard files are unavailable", {
                      description:
                        error instanceof Error ? error.message : undefined,
                    });
                  });
              }}
            >
              <ClipboardPaste className="size-3.5" />
            </Button>
            <CustomEmojiPickerButton
              emoji={customEmoji}
              label="Insert custom emoji"
              managePubkey={draftPubkey}
              onSelect={insertCustomEmoji}
            />
            <Button
              aria-label="Send message"
              className="size-8 p-0"
              disabled={
                (!content.trim() && readyAttachments.length === 0) ||
                sending ||
                hasUploading ||
                hasFailed
              }
              type="button"
              onClick={submit}
            >
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}

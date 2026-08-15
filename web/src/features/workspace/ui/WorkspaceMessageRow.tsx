import {
  emojiFromTags,
  type CustomEmoji,
} from "@/features/custom-emoji/custom-emoji-policy";
import { CustomEmojiMarkdown } from "@/features/custom-emoji/ui/CustomEmojiMarkdown";
import { CustomEmojiPickerButton } from "@/features/custom-emoji/ui/CustomEmojiPickerButton";
import { EmojiPickerButton } from "@/features/custom-emoji/ui/EmojiPickerButton";
import {
  parseImetaTags,
  stripAttachmentMarkdown,
} from "@/features/media/media-policy";
import { WorkspaceMediaGallery } from "@/features/media/ui/WorkspaceMediaGallery";
import { MessageReminderButton } from "@/features/reminders/ui/MessageReminderButton";
import type {
  ReactionSummary,
  WorkspaceMessage,
  WorkspaceProfile,
} from "../workspace-api";
import type { UserStatus } from "@/features/profiles/profile-api";
import { ReactionPill } from "./ReactionPill";
import { ProfileAvatar } from "./WorkspaceSidebar";

export type TimelineMessage = WorkspaceMessage & {
  edited?: boolean;
};

function MessageActions({
  own,
  customEmoji,
  message,
  onReply,
  onReact,
  onEdit,
  onDelete,
}: {
  own: boolean;
  customEmoji: readonly CustomEmoji[];
  message: TimelineMessage;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute -top-4 right-4 flex items-center rounded-lg border border-border bg-popover opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {["👍", "✅", "❤️"].map((emoji) => (
        <button
          aria-label={`React with ${emoji}`}
          className="px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
        >
          {emoji}
        </button>
      ))}
      <EmojiPickerButton
        label="Choose a reaction"
        placement="bottom"
        onSelect={onReact}
      />
      <CustomEmojiPickerButton
        emoji={customEmoji}
        label="Choose custom reaction"
        placement="bottom"
        onSelect={onReact}
      />
      <button
        className="border-l border-border px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        type="button"
        onClick={onReply}
      >
        Reply
      </button>
      <MessageReminderButton
        target={{
          authorPubkey: message.pubkey,
          channelId: message.channelId,
          eventId: message.id,
          preview: message.content,
        }}
      />
      {own ? (
        <>
          <button
            className="px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
            type="button"
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            className="px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
            type="button"
            onClick={onDelete}
          >
            Delete
          </button>
        </>
      ) : null}
    </div>
  );
}

type WorkspaceMessageRowProps = {
  message: TimelineMessage;
  profile: WorkspaceProfile;
  status: UserStatus | null;
  ownPubkey: string;
  reactions: ReactionSummary[];
  customEmoji: readonly CustomEmoji[];
  reactionActorName: (pubkey: string) => string;
  workflowName?: string;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function WorkspaceMessageRow({
  message,
  profile,
  status,
  ownPubkey,
  reactions,
  customEmoji,
  reactionActorName,
  workflowName,
  onReply,
  onReact,
  onEdit,
  onDelete,
}: WorkspaceMessageRowProps) {
  const media = parseImetaTags(message.tags);
  const messageContent = stripAttachmentMarkdown(message.content, media);
  const timestamp = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(message.created_at * 1000);
  return (
    <article className="group relative flex gap-3 px-5 py-2.5 hover:bg-muted/40 sm:px-7">
      <ProfileAvatar profile={profile} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{profile.name}</span>
          {workflowName ? (
            <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
              Workflow
            </span>
          ) : null}
          {status ? (
            <span
              aria-label={
                status.text
                  ? `Current status: ${status.emoji ? `${status.emoji} ` : ""}${status.text}`
                  : `Current status: ${status.emoji}`
              }
              className="shrink-0 text-xs"
              role="img"
              title={status.text || status.emoji}
            >
              {status.emoji || "●"}
            </span>
          ) : null}
          {profile.isAgent ? (
            <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary">
              AGENT
            </span>
          ) : null}
          <time className="text-[0.6875rem] text-black/35 dark:text-white/30">
            {timestamp}
          </time>
          {message.edited ? (
            <span className="text-[0.6875rem] text-black/30 dark:text-white/25">
              edited
            </span>
          ) : null}
        </div>
        <div className="prose prose-sm mt-0.5 max-w-none break-words text-[0.9375rem] leading-6 prose-p:my-0 prose-pre:my-2 dark:prose-invert">
          <CustomEmojiMarkdown
            content={messageContent}
            emoji={emojiFromTags(message.tags)}
          />
        </div>
        <WorkspaceMediaGallery tags={message.tags} />
        {reactions.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {reactions.map((reaction) => (
              <ReactionPill
                key={reaction.emoji}
                actorName={reactionActorName}
                ownPubkey={ownPubkey}
                reaction={reaction}
                onToggle={onReact}
              />
            ))}
          </div>
        ) : null}
      </div>
      <MessageActions
        own={message.pubkey === ownPubkey}
        customEmoji={customEmoji}
        message={message}
        onDelete={onDelete}
        onEdit={onEdit}
        onReact={onReact}
        onReply={onReply}
      />
    </article>
  );
}

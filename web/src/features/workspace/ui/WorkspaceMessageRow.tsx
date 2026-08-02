import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ReactionSummary,
  WorkspaceMessage,
  WorkspaceProfile,
} from "../workspace-api";
import { ReactionPill } from "./ReactionPill";
import { ProfileAvatar } from "./WorkspaceSidebar";
import { ThreadReplyCount } from "./ThreadReplyCount";

export type TimelineMessage = WorkspaceMessage & {
  edited?: boolean;
};

function MessageActions({
  own,
  onReply,
  onReact,
  onEdit,
  onDelete,
}: {
  own: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute -top-4 right-4 flex items-center overflow-hidden rounded-lg border border-black/10 bg-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100 dark:border-white/10 dark:bg-[#22251f]">
      {["👍", "✅", "❤️"].map((emoji) => (
        <button
          aria-label={`React with ${emoji}`}
          className="px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
        >
          {emoji}
        </button>
      ))}
      <button
        className="border-l border-black/8 px-2 py-1.5 text-xs hover:bg-black/5 dark:border-white/8 dark:hover:bg-white/5"
        type="button"
        onClick={onReply}
      >
        Reply
      </button>
      {own ? (
        <>
          <button
            className="px-2 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
            type="button"
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
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
  ownPubkey: string;
  reactions: ReactionSummary[];
  replyCount: number;
  reactionActorName: (pubkey: string) => string;
  threadExpanded?: boolean;
  onOpenThreadPanel: () => void;
  onReply: () => void;
  onToggleInlineThread: () => void;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function WorkspaceMessageRow({
  message,
  profile,
  ownPubkey,
  reactions,
  replyCount,
  reactionActorName,
  threadExpanded,
  onOpenThreadPanel,
  onReply,
  onToggleInlineThread,
  onReact,
  onEdit,
  onDelete,
}: WorkspaceMessageRowProps) {
  const timestamp = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(message.created_at * 1000);
  return (
    <article className="group relative flex gap-3 px-5 py-2.5 hover:bg-black/[0.025] dark:hover:bg-white/[0.025] sm:px-7">
      <ProfileAvatar profile={profile} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{profile.name}</span>
          {profile.isAgent ? (
            <span className="rounded-md bg-[#d7d72e]/25 px-1.5 py-0.5 text-[0.625rem] font-semibold text-[#707000] dark:text-[#e4e56a]">
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
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
        </div>
        {reactions.length || replyCount ? (
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
            {replyCount ? (
              <ThreadReplyCount
                expanded={Boolean(threadExpanded)}
                messageId={message.id}
                replyCount={replyCount}
                onOpenPanel={onOpenThreadPanel}
                onToggleInline={onToggleInlineThread}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <MessageActions
        own={message.pubkey === ownPubkey}
        onDelete={onDelete}
        onEdit={onEdit}
        onReact={onReact}
        onReply={onReply}
      />
    </article>
  );
}

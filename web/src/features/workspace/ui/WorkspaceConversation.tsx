import {
  ChevronLeft,
  EyeOff,
  Hash,
  Lock,
  Menu,
  Settings2,
  Star,
  UserPlus,
  Users,
  VolumeX,
  X,
} from "lucide-react";
import { WorkspaceComposer } from "./WorkspaceComposer";
import { WorkspaceMessageRow } from "./WorkspaceMessageRow";
import type { CustomEmoji } from "@/features/custom-emoji/custom-emoji-policy";
import type { UserStatus } from "@/features/profiles/profile-api";
import type { WorkspaceReactionMap } from "@/features/workspace/reaction-cache";
import type {
  WorkspaceChannel,
  WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import type { TimelineMessage } from "../workspace-messages";
import { workflowMessagePresentation } from "../workspace-message-presentation";

function messagePresentation(
  message: TimelineMessage,
  profileFor: (pubkey: string) => WorkspaceProfile,
): { profile: WorkspaceProfile; statusPubkey: string; workflowName?: string } {
  const workflow = workflowMessagePresentation(message);
  if (!workflow) {
    return {
      profile: profileFor(message.pubkey),
      statusPubkey: message.pubkey,
    };
  }
  return {
    profile: {
      pubkey: message.pubkey,
      name: workflow.workflowName,
      about: `Relay workflow owned by ${profileFor(workflow.actorPubkey).name}`,
    },
    statusPubkey: workflow.actorPubkey,
    workflowName: workflow.workflowName,
  };
}

type WorkspaceConversationProps = {
  activeChannel: WorkspaceChannel | null;
  agents: WorkspaceProfile[];
  customEmoji: readonly CustomEmoji[];
  expandedThreadIds: Set<string>;
  hideDirectMessagePending: boolean;
  messagesPending: boolean;
  mutedChannelIds: Set<string>;
  onlineMemberCount: number;
  ownPubkey: string;
  reactionActorName: (pubkey: string) => string;
  reactions: WorkspaceReactionMap | undefined;
  repliesByThread: Map<string, TimelineMessage[]>;
  replyCounts: Map<string, number>;
  sendPending: boolean;
  starredChannelIds: Set<string>;
  statusFor: (pubkey: string) => UserStatus | null;
  threadReplies: TimelineMessage[];
  threadRoot: TimelineMessage | null;
  topLevel: TimelineMessage[];
  typingNames: string[];
  profileFor: (pubkey: string) => WorkspaceProfile;
  onAddDmMembers: () => void;
  onCloseInlineThread: (messageId: string) => void;
  onDeleteMessage: (message: TimelineMessage) => void;
  onEditMessage: (message: TimelineMessage) => void;
  onHideDirectMessage: () => void;
  onOpenNavigation: () => void;
  onOpenThreadPanel: (messageId: string) => void;
  onReply: (messageId: string) => void;
  onSend: (
    content: string,
    mentions: string[],
    mediaTags: string[][] | undefined,
    replyTo?: TimelineMessage,
  ) => void;
  onSetChannelSettingsOpen: () => void;
  onSetThreadRoot: (messageId: string | null) => void;
  onToggleInlineThread: (messageId: string) => void;
  onToggleMute: (channelId: string) => void;
  onToggleReaction: (message: TimelineMessage, emoji: string) => void;
  onToggleStar: (channelId: string) => void;
  onTyping: () => void;
};

/** The channel timeline and thread panel, kept separate from workspace navigation. */
export function WorkspaceConversation({
  activeChannel,
  agents,
  customEmoji,
  expandedThreadIds,
  hideDirectMessagePending,
  messagesPending,
  mutedChannelIds,
  onlineMemberCount,
  ownPubkey,
  reactionActorName,
  reactions,
  repliesByThread,
  replyCounts,
  sendPending,
  starredChannelIds,
  statusFor,
  threadReplies,
  threadRoot,
  topLevel,
  typingNames,
  profileFor,
  onAddDmMembers,
  onCloseInlineThread,
  onDeleteMessage,
  onEditMessage,
  onHideDirectMessage,
  onOpenNavigation,
  onOpenThreadPanel,
  onReply,
  onSend,
  onSetChannelSettingsOpen,
  onSetThreadRoot,
  onToggleInlineThread,
  onToggleMute,
  onToggleReaction,
  onToggleStar,
  onTyping,
}: WorkspaceConversationProps) {
  return (
    <>
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-testid="workspace-chat-pane"
      >
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/8 px-4 dark:border-white/8 sm:px-6">
          <button
            aria-label="Open navigation"
            className="rounded-lg p-2 hover:bg-black/5 md:hidden dark:hover:bg-white/5"
            type="button"
            onClick={onOpenNavigation}
          >
            <Menu className="size-4" />
          </button>
          {activeChannel ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {activeChannel.visibility === "private" ? (
                  <Lock className="size-4 shrink-0 text-black/40 dark:text-white/35" />
                ) : (
                  <Hash className="size-4 shrink-0 text-black/40 dark:text-white/35" />
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-sm font-semibold">
                    {activeChannel.name}
                  </h1>
                  {activeChannel.topic || activeChannel.about ? (
                    <p className="truncate text-xs text-black/40 dark:text-white/35">
                      {activeChannel.topic || activeChannel.about}
                    </p>
                  ) : null}
                </div>
                {activeChannel.type !== "dm" ? (
                  <button
                    aria-label={`${starredChannelIds.has(activeChannel.id) ? "Remove" : "Add"} ${activeChannel.name} ${starredChannelIds.has(activeChannel.id) ? "from" : "to"} favorites`}
                    className="rounded-lg p-2 text-black/35 hover:bg-black/5 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/65"
                    type="button"
                    onClick={() => onToggleStar(activeChannel.id)}
                  >
                    <Star
                      className={`size-4 ${starredChannelIds.has(activeChannel.id) ? "fill-current text-[#8b8c00] dark:text-[#e4e55e]" : ""}`}
                    />
                  </button>
                ) : null}
                {activeChannel.type !== "dm" ? (
                  <button
                    aria-label={`${mutedChannelIds.has(activeChannel.id) ? "Unmute" : "Mute"} ${activeChannel.name}`}
                    className={`rounded-lg p-2 text-black/35 hover:bg-black/5 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/65 ${mutedChannelIds.has(activeChannel.id) ? "text-[#8b8c00] dark:text-[#e4e55e]" : ""}`}
                    type="button"
                    onClick={() => onToggleMute(activeChannel.id)}
                  >
                    <VolumeX
                      className={
                        mutedChannelIds.has(activeChannel.id)
                          ? "size-4"
                          : "size-4 opacity-60"
                      }
                    />
                  </button>
                ) : null}
                {activeChannel.type === "dm" ? (
                  <>
                    <button
                      aria-label={`Add people to ${activeChannel.name}`}
                      className="rounded-lg p-2 text-black/35 hover:bg-black/5 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/65"
                      type="button"
                      onClick={onAddDmMembers}
                    >
                      <UserPlus className="size-4" />
                    </button>
                    <button
                      aria-label={`Hide ${activeChannel.name}`}
                      className="rounded-lg p-2 text-black/35 hover:bg-black/5 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/65"
                      disabled={hideDirectMessagePending}
                      type="button"
                      onClick={onHideDirectMessage}
                    >
                      <EyeOff className="size-4" />
                    </button>
                  </>
                ) : null}
                {activeChannel.type !== "dm" ? (
                  <button
                    aria-label={`Manage ${activeChannel.name}`}
                    className="rounded-lg p-2 text-black/35 hover:bg-black/5 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/65"
                    type="button"
                    onClick={onSetChannelSettingsOpen}
                  >
                    <Settings2 className="size-4" />
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-1 text-black/40 dark:text-white/35">
                <span
                  className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs sm:flex"
                  title={
                    onlineMemberCount
                      ? `${onlineMemberCount} online`
                      : "No members currently online"
                  }
                >
                  <Users className="size-3.5" />
                  <span
                    aria-hidden="true"
                    className={
                      onlineMemberCount
                        ? "size-1.5 rounded-full bg-emerald-500"
                        : "size-1.5 rounded-full bg-muted-foreground/35"
                    }
                  />
                  {activeChannel.memberPubkeys.length}
                </span>
              </div>
            </>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {messagesPending ? (
            <div className="space-y-4 px-6 py-4">
              {[0, 1, 2, 3].map((item) => (
                <div className="flex animate-pulse gap-3" key={item}>
                  <div className="size-9 rounded-xl bg-black/8 dark:bg-white/8" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 rounded bg-black/8 dark:bg-white/8" />
                    <div className="h-3 w-2/3 rounded bg-black/6 dark:bg-white/6" />
                  </div>
                </div>
              ))}
            </div>
          ) : topLevel.length ? (
            topLevel.map((message) => {
              const replies = repliesByThread.get(message.id) ?? [];
              const inlineExpanded = expandedThreadIds.has(message.id);
              const replyTarget = replies[replies.length - 1] ?? message;
              const presentation = messagePresentation(message, profileFor);
              return (
                <div key={message.id}>
                  <WorkspaceMessageRow
                    customEmoji={customEmoji}
                    message={message}
                    ownPubkey={ownPubkey}
                    profile={presentation.profile}
                    status={
                      presentation.workflowName
                        ? null
                        : statusFor(presentation.statusPubkey)
                    }
                    workflowName={presentation.workflowName}
                    reactions={reactions?.get(message.id) ?? []}
                    replyCount={replyCounts.get(message.id) ?? 0}
                    reactionActorName={reactionActorName}
                    threadExpanded={inlineExpanded}
                    onDelete={() => {
                      if (window.confirm("Delete this message?")) {
                        onDeleteMessage(message);
                      }
                    }}
                    onEdit={() => onEditMessage(message)}
                    onOpenThreadPanel={() => onOpenThreadPanel(message.id)}
                    onReact={(emoji) => onToggleReaction(message, emoji)}
                    onReply={() => onReply(message.id)}
                    onToggleInlineThread={() =>
                      onToggleInlineThread(message.id)
                    }
                  />
                  {inlineExpanded ? (
                    <section
                      aria-label={`Replies to ${presentation.profile.name}`}
                      className="mb-2 ml-10 border-l border-black/10 pl-2 dark:border-white/10 sm:ml-14 sm:pl-3"
                      data-testid={`inline-thread-${message.id}`}
                      id={`inline-thread-${message.id}`}
                    >
                      <p className="px-2 pt-2 text-xs font-medium text-black/40 dark:text-white/35">
                        {replies.length}{" "}
                        {replies.length === 1 ? "reply" : "replies"}
                      </p>
                      {replies.map((reply) => {
                        const replyPresentation = messagePresentation(
                          reply,
                          profileFor,
                        );
                        return (
                          <WorkspaceMessageRow
                            customEmoji={customEmoji}
                            key={reply.id}
                            message={reply}
                            ownPubkey={ownPubkey}
                            profile={replyPresentation.profile}
                            status={
                              replyPresentation.workflowName
                                ? null
                                : statusFor(replyPresentation.statusPubkey)
                            }
                            workflowName={replyPresentation.workflowName}
                            reactions={reactions?.get(reply.id) ?? []}
                            replyCount={0}
                            reactionActorName={reactionActorName}
                            onDelete={() => onDeleteMessage(reply)}
                            onEdit={() => onEditMessage(reply)}
                            onOpenThreadPanel={() =>
                              onSetThreadRoot(message.id)
                            }
                            onReact={(emoji) => onToggleReaction(reply, emoji)}
                            onReply={() => onReply(message.id)}
                            onToggleInlineThread={() => {}}
                          />
                        );
                      })}
                      {activeChannel ? (
                        <WorkspaceComposer
                          agents={agents}
                          channel={activeChannel}
                          customEmoji={customEmoji}
                          compact
                          draftPubkey={ownPubkey}
                          replyTo={replyTarget}
                          sending={sendPending}
                          onTyping={onTyping}
                          onCancelReply={() => onCloseInlineThread(message.id)}
                          onSend={(content, mentions, mediaTags) =>
                            onSend(content, mentions, mediaTags, replyTarget)
                          }
                        />
                      ) : null}
                    </section>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="flex h-full min-h-72 items-center justify-center px-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#d7d72e]/25 text-[#7d7e00]">
                  <Hash className="size-5" />
                </div>
                <h2 className="mt-4 font-semibold">
                  Start the conversation in #{activeChannel?.name}
                </h2>
                <p className="mt-2 text-sm leading-6 text-black/45 dark:text-white/40">
                  Share an update or mention a hosted agent to give it work.
                </p>
              </div>
            </div>
          )}
        </div>
        {activeChannel ? (
          <>
            {typingNames.length ? (
              <p
                className="px-4 pb-1 text-xs text-muted-foreground sm:px-6"
                data-testid="typing-indicator"
              >
                {typingNames.length === 1
                  ? `${typingNames[0]} is typing…`
                  : `${typingNames.slice(0, 2).join(" and ")} are typing…`}
              </p>
            ) : null}
            <WorkspaceComposer
              agents={agents}
              channel={activeChannel}
              customEmoji={customEmoji}
              draftPubkey={ownPubkey}
              sending={sendPending}
              onTyping={onTyping}
              onSend={(content, mentions, mediaTags) =>
                onSend(content, mentions, mediaTags)
              }
            />
          </>
        ) : null}
      </section>

      {threadRoot ? (
        <aside className="fixed inset-0 z-40 flex flex-col bg-[#f8f9f4] dark:bg-[#171916] md:static md:w-[24rem] md:border-l md:border-black/8 md:dark:border-white/8">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/8 px-4 dark:border-white/8">
            <button
              aria-label="Close thread"
              className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
              type="button"
              onClick={() => onSetThreadRoot(null)}
            >
              <ChevronLeft className="size-4 md:hidden" />
              <X className="hidden size-4 md:block" />
            </button>
            <div>
              <h2 className="text-sm font-semibold">Thread</h2>
              <p className="text-xs text-black/40 dark:text-white/35">
                #{activeChannel?.name}
              </p>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            {[threadRoot, ...threadReplies].map((message) => {
              const presentation = messagePresentation(message, profileFor);
              return (
                <WorkspaceMessageRow
                  customEmoji={customEmoji}
                  key={message.id}
                  message={message}
                  ownPubkey={ownPubkey}
                  profile={presentation.profile}
                  status={
                    presentation.workflowName
                      ? null
                      : statusFor(presentation.statusPubkey)
                  }
                  workflowName={presentation.workflowName}
                  reactions={reactions?.get(message.id) ?? []}
                  replyCount={0}
                  reactionActorName={reactionActorName}
                  onDelete={() => onDeleteMessage(message)}
                  onEdit={() => onEditMessage(message)}
                  onOpenThreadPanel={() => {}}
                  onReact={(emoji) => onToggleReaction(message, emoji)}
                  onReply={() => {}}
                  onToggleInlineThread={() => {}}
                />
              );
            })}
          </div>
          {activeChannel ? (
            <WorkspaceComposer
              agents={agents}
              channel={activeChannel}
              customEmoji={customEmoji}
              draftPubkey={ownPubkey}
              replyTo={threadRoot}
              sending={sendPending}
              onTyping={onTyping}
              onSend={(content, mentions, mediaTags) =>
                onSend(
                  content,
                  mentions,
                  mediaTags,
                  threadReplies[threadReplies.length - 1] ?? threadRoot,
                )
              }
            />
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

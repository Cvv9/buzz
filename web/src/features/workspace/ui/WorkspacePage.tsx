import { ChevronLeft, Hash, Lock, Menu, Send, Users, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  type BrowserIdentity,
  type StoredBrowserIdentitySummary,
  getStoredBrowserIdentity,
  getUnlockedBrowserIdentity,
  lockBrowserIdentity,
} from "@/shared/lib/browser-identity";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { IdentityGate } from "./IdentityGate";
import { EmptyMembership } from "./EmptyMembership";
import { ProfileAvatar, WorkspaceSidebar } from "./WorkspaceSidebar";
import { WorkspaceGuide } from "./WorkspaceGuide";
import { WorkspaceSettings } from "./WorkspaceSettings";
import {
  KIND_DELETION,
  KIND_NIP29_DELETE,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_STREAM_MESSAGE_V2,
  type ReactionSummary,
  type WorkspaceChannel,
  type WorkspaceMessage,
  type WorkspaceProfile,
  addWorkspaceMember,
  createWorkspaceChannel,
  deleteWorkspaceMessage,
  editWorkspaceMessage,
  listAgents,
  listChannelMessages,
  listProfiles,
  listReactions,
  listWorkspaceChannels,
  isConversationalWorkspaceMessage,
  publishWorkspaceProfile,
  reactToWorkspaceMessage,
  sendWorkspaceMessage,
  subscribeToChannels,
  subscribeToReactions,
} from "@/features/workspace/workspace-api";

type TimelineMessage = WorkspaceMessage & {
  edited?: boolean;
};

function tagValue(event: WorkspaceMessage, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function materializeMessages(events: WorkspaceMessage[]): TimelineMessage[] {
  const deleted = new Set(
    events
      .filter(
        (event) =>
          event.kind === KIND_DELETION || event.kind === KIND_NIP29_DELETE,
      )
      .map((event) => tagValue(event, "e"))
      .filter((value): value is string => Boolean(value)),
  );
  const edits = new Map<string, WorkspaceMessage>();
  for (const event of events) {
    if (event.kind !== KIND_STREAM_MESSAGE_EDIT) continue;
    const target = tagValue(event, "e");
    if (!target) continue;
    const current = edits.get(target);
    if (!current || event.created_at >= current.created_at) {
      edits.set(target, event);
    }
  }
  return events
    .filter(
      (event) =>
        event.kind === KIND_STREAM_MESSAGE ||
        event.kind === KIND_STREAM_MESSAGE_V2,
    )
    .filter((event) => !deleted.has(event.id))
    .map((event) => {
      const edit = edits.get(event.id);
      return edit ? { ...event, content: edit.content, edited: true } : event;
    });
}

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

function MessageRow({
  message,
  profile,
  ownPubkey,
  reactions,
  replyCount,
  onOpenThread,
  onReact,
  onEdit,
  onDelete,
}: {
  message: TimelineMessage;
  profile: WorkspaceProfile;
  ownPubkey: string;
  reactions: ReactionSummary[];
  replyCount: number;
  onOpenThread: () => void;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
              <button
                className={cn(
                  "rounded-lg border px-2 py-0.5 text-xs",
                  reaction.authors.includes(ownPubkey)
                    ? "border-[#b6b71e] bg-[#d7d72e]/20"
                    : "border-black/10 bg-black/[0.025] hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]",
                )}
                key={reaction.emoji}
                type="button"
                onClick={() => onReact(reaction.emoji)}
              >
                {reaction.emoji} {reaction.authors.length}
              </button>
            ))}
            {replyCount ? (
              <button
                className="ml-1 text-xs font-medium text-[#777800] hover:underline dark:text-[#d7d72e]"
                type="button"
                onClick={onOpenThread}
              >
                {replyCount} {replyCount === 1 ? "reply" : "replies"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <MessageActions
        own={message.pubkey === ownPubkey}
        onDelete={onDelete}
        onEdit={onEdit}
        onReact={onReact}
        onReply={onOpenThread}
      />
    </article>
  );
}

function Composer({
  channel,
  agents,
  replyTo,
  onCancelReply,
  onSend,
  sending,
}: {
  channel: WorkspaceChannel;
  agents: WorkspaceProfile[];
  replyTo?: TimelineMessage;
  onCancelReply?: () => void;
  onSend: (content: string, mentions: string[]) => void;
  sending: boolean;
}) {
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
      .filter((agent) => lowered.includes(`@${agent.name.toLocaleLowerCase()}`))
      .map((agent) => agent.pubkey);
    onSend(trimmed, mentions);
    setContent("");
  };

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6 sm:pb-5">
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
          className="block max-h-40 min-h-16 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-black/35 dark:placeholder:text-white/30"
          placeholder={
            agents.length
              ? `Message #${channel.name}, or @mention an agent`
              : `Message #${channel.name}`
          }
          ref={textareaRef}
          rows={2}
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

export function WorkspacePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [identity, setIdentity] = React.useState<BrowserIdentity | null>(null);
  const [storedIdentity, setStoredIdentity] =
    React.useState<StoredBrowserIdentitySummary | null>(null);
  const [identityLoading, setIdentityLoading] = React.useState(true);
  const [activeChannelId, setActiveChannelId] = React.useState<string | null>(
    () => localStorage.getItem("buzz.web.active-channel"),
  );
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [unreadChannelIds, setUnreadChannelIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const activeChannelIdRef = React.useRef(activeChannelId);
  React.useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
    if (!activeChannelId) return;
    setUnreadChannelIds((current) => {
      if (!current.has(activeChannelId)) return current;
      const next = new Set(current);
      next.delete(activeChannelId);
      return next;
    });
  }, [activeChannelId]);
  const [threadRootId, setThreadRootId] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const [createChannelOpen, setCreateChannelOpen] = React.useState(false);
  const [channelName, setChannelName] = React.useState("");
  const [channelAbout, setChannelAbout] = React.useState("");
  const [editingMessage, setEditingMessage] =
    React.useState<TimelineMessage | null>(null);

  React.useEffect(() => {
    let active = true;
    const unlocked = getUnlockedBrowserIdentity();
    if (unlocked) setIdentity(unlocked);
    getStoredBrowserIdentity()
      .then((stored) => {
        if (active) setStoredIdentity(stored);
      })
      .finally(() => {
        if (active) setIdentityLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const channelsQuery = useQuery({
    queryKey: ["workspace-channels", identity?.pubkey],
    queryFn: () => listWorkspaceChannels(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    retry: false,
  });
  const agentsQuery = useQuery({
    queryKey: ["workspace-agents", identity?.pubkey],
    queryFn: () => listAgents(identity?.pubkey ?? ""),
    enabled: Boolean(identity && channelsQuery.data?.length),
    retry: false,
  });

  const channels = channelsQuery.data ?? [];
  React.useEffect(() => {
    if (
      channels.length &&
      !channels.some((channel) => channel.id === activeChannelId)
    ) {
      setActiveChannelId(channels[0]?.id ?? null);
    }
  }, [activeChannelId, channels]);
  React.useEffect(() => {
    if (activeChannelId) {
      localStorage.setItem("buzz.web.active-channel", activeChannelId);
    }
  }, [activeChannelId]);

  const activeChannel =
    channels.find((channel) => channel.id === activeChannelId) ?? null;
  const messagesQuery = useQuery({
    queryKey: ["channel-messages", activeChannelId],
    queryFn: () => listChannelMessages(activeChannelId ?? ""),
    enabled: Boolean(activeChannelId),
  });
  const materialized = React.useMemo(
    () => materializeMessages(messagesQuery.data ?? []),
    [messagesQuery.data],
  );
  const profilePubkeys = React.useMemo(
    () => [
      ...(identity ? [identity.pubkey] : []),
      ...materialized.map((message) => message.pubkey),
      ...channels.flatMap((channel) => channel.memberPubkeys),
      ...(agentsQuery.data ?? []).map((agent) => agent.pubkey),
    ],
    [agentsQuery.data, channels, identity, materialized],
  );
  const profilesQuery = useQuery({
    queryKey: ["workspace-profiles", [...new Set(profilePubkeys)].sort()],
    queryFn: () => listProfiles(profilePubkeys),
    enabled: profilePubkeys.length > 0,
  });
  const messageIds = React.useMemo(
    () => materialized.map((message) => message.id),
    [materialized],
  );
  const reactionsQuery = useQuery({
    queryKey: ["workspace-reactions", messageIds],
    queryFn: () => listReactions(messageIds),
    enabled: messageIds.length > 0,
  });

  React.useEffect(
    () =>
      subscribeToReactions(messageIds, () => {
        void queryClient.invalidateQueries({
          queryKey: ["workspace-reactions"],
        });
      }),
    [messageIds, queryClient],
  );

  React.useEffect(() => {
    if (!identity || channels.length === 0) return;
    const channelsById = new Map(
      channels.map((channel) => [channel.id, channel]),
    );
    return subscribeToChannels(
      channels.map((channel) => channel.id),
      (event) => {
        queryClient.setQueryData<WorkspaceMessage[]>(
          ["channel-messages", event.channelId],
          (current = []) =>
            current.some((existing) => existing.id === event.id)
              ? current
              : [...current, event].sort(
                  (a, b) =>
                    a.created_at - b.created_at || a.id.localeCompare(b.id),
                ),
        );
        if (
          !isConversationalWorkspaceMessage(event) ||
          event.pubkey === identity.pubkey ||
          event.channelId === activeChannelIdRef.current
        ) {
          return;
        }
        setUnreadChannelIds((current) => {
          if (current.has(event.channelId)) return current;
          return new Set(current).add(event.channelId);
        });
        const channel = channelsById.get(event.channelId);
        if (
          channel &&
          document.hidden &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification(`New message in #${channel.name}`, {
            body:
              event.content.length > 180
                ? `${event.content.slice(0, 177)}…`
                : event.content,
            tag: `buzz-channel-${event.channelId}`,
          });
        }
      },
    );
  }, [channels, identity, queryClient]);

  React.useEffect(() => {
    if (!identity || !channels.length) return;
    const marker = `buzz.web.profile-published.${identity.pubkey}`;
    if (localStorage.getItem(marker)) return;
    publishWorkspaceProfile(identity.pubkey, identity.displayName)
      .then(() => {
        localStorage.setItem(marker, "true");
        void queryClient.invalidateQueries({
          queryKey: ["workspace-profiles"],
        });
      })
      .catch(() => {
        // Profile publishing is retried on the next load.
      });
  }, [channels.length, identity, queryClient]);

  const sendMutation = useMutation({
    mutationFn: ({
      content,
      replyTo,
      mentions,
    }: {
      content: string;
      replyTo?: TimelineMessage;
      mentions: string[];
    }) =>
      sendWorkspaceMessage(activeChannelId ?? "", content, replyTo, mentions),
    onSuccess: (event, variables) => {
      queryClient.setQueryData<WorkspaceMessage[]>(
        ["channel-messages", activeChannelId],
        (current = []) => [
          ...current,
          {
            ...event,
            channelId: activeChannelId ?? "",
            rootEventId: variables.replyTo
              ? (variables.replyTo.rootEventId ?? variables.replyTo.id)
              : null,
            parentEventId: variables.replyTo?.id ?? null,
          },
        ],
      );
    },
  });
  const createChannelMutation = useMutation({
    mutationFn: () => createWorkspaceChannel(channelName, channelAbout),
    onSuccess: async () => {
      setCreateChannelOpen(false);
      setChannelName("");
      setChannelAbout("");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      await channelsQuery.refetch();
    },
  });
  const reactMutation = useMutation({
    mutationFn: ({
      message,
      emoji,
    }: {
      message: TimelineMessage;
      emoji: string;
    }) => reactToWorkspaceMessage(message, emoji),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["workspace-reactions"] }),
  });
  const editMutation = useMutation({
    mutationFn: ({
      message,
      content,
    }: {
      message: TimelineMessage;
      content: string;
    }) => editWorkspaceMessage(message, content),
    onSuccess: () => {
      setEditingMessage(null);
      void messagesQuery.refetch();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteWorkspaceMessage,
    onSuccess: () => messagesQuery.refetch(),
  });
  const addAgentMutation = useMutation({
    mutationFn: (agent: WorkspaceProfile) =>
      addWorkspaceMember(activeChannelId ?? "", agent.pubkey, "bot"),
    onSuccess: async (_, agent) => {
      toast.success(`${agent.name} was added to this channel`);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      await channelsQuery.refetch();
    },
    onError: (error) => {
      toast.error("Could not add the hosted agent", {
        description:
          error instanceof Error
            ? error.message
            : "Owner or admin access is required.",
      });
    },
  });

  if (identityLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#151713] text-white/55">
        Opening VarVik Studios…
      </div>
    );
  }
  if (!identity) {
    const pendingInvitePath = sessionStorage.getItem(
      "buzz.web.pending-invite-path",
    );
    return (
      <IdentityGate
        pendingInvite={Boolean(pendingInvitePath)}
        storedIdentity={storedIdentity}
        onReady={(readyIdentity) => {
          queryClient.clear();
          setIdentity(readyIdentity);
          setStoredIdentity({ ...readyIdentity, protection: "password" });
          if (pendingInvitePath) {
            sessionStorage.removeItem("buzz.web.pending-invite-path");
            const inviteMatch = pendingInvitePath.match(/^\/invite\/([^/]+)$/);
            if (inviteMatch?.[1]) {
              void navigate({
                to: "/invite/$code",
                params: { code: decodeURIComponent(inviteMatch[1]) },
              });
            }
          }
        }}
      />
    );
  }
  if (
    channelsQuery.isError ||
    (!channelsQuery.isPending && channels.length === 0)
  ) {
    return (
      <EmptyMembership
        onJoined={async () => {
          await channelsQuery.refetch();
        }}
      />
    );
  }
  if (channelsQuery.isPending) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f5ee] text-black/45 dark:bg-[#151713] dark:text-white/40">
        Connecting to VarVik Studios…
      </div>
    );
  }

  const profileFor = (pubkey: string): WorkspaceProfile =>
    profilesQuery.data?.get(pubkey) ??
    agentsQuery.data?.find((profile) => profile.pubkey === pubkey) ?? {
      pubkey,
      name:
        pubkey === identity.pubkey
          ? identity.displayName
          : truncatePubkey(pubkey),
    };
  const topLevel = materialized.filter((message) => !message.rootEventId);
  const threadRoot =
    materialized.find((message) => message.id === threadRootId) ?? null;
  const threadReplies = threadRootId
    ? materialized.filter((message) => message.rootEventId === threadRootId)
    : [];
  const currentProfile = profileFor(identity.pubkey);
  const replyCounts = new Map<string, number>();
  for (const message of materialized) {
    if (message.rootEventId) {
      replyCounts.set(
        message.rootEventId,
        (replyCounts.get(message.rootEventId) ?? 0) + 1,
      );
    }
  }

  return (
    <div
      className="flex h-dvh min-h-0 overflow-hidden bg-[#f8f9f4] text-[#292c25] dark:bg-[#141612] dark:text-[#e6e8dc]"
      data-testid="workspace-shell"
    >
      <WorkspaceSidebar
        activeChannelId={activeChannelId}
        agents={agentsQuery.data ?? []}
        channels={channels}
        identity={identity}
        profile={currentProfile}
        unreadChannelIds={unreadChannelIds}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCreateChannel={() => setCreateChannelOpen(true)}
        onAddAgent={(agent) => addAgentMutation.mutate(agent)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
        onSelectChannel={(channelId) => {
          setActiveChannelId(channelId);
          setThreadRootId(null);
        }}
      />

      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="workspace-chat-pane"
        >
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/8 px-4 dark:border-white/8 sm:px-6">
            <button
              aria-label="Open navigation"
              className="rounded-lg p-2 hover:bg-black/5 md:hidden dark:hover:bg-white/5"
              type="button"
              onClick={() => setSidebarOpen(true)}
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
                </div>
                <div className="flex items-center gap-1 text-black/40 dark:text-white/35">
                  <span className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs sm:flex">
                    <Users className="size-3.5" />
                    {activeChannel.memberPubkeys.length}
                  </span>
                </div>
              </>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            {messagesQuery.isPending ? (
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
              topLevel.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  ownPubkey={identity.pubkey}
                  profile={profileFor(message.pubkey)}
                  reactions={reactionsQuery.data?.get(message.id) ?? []}
                  replyCount={replyCounts.get(message.id) ?? 0}
                  onDelete={() => {
                    if (window.confirm("Delete this message?")) {
                      deleteMutation.mutate(message);
                    }
                  }}
                  onEdit={() => setEditingMessage(message)}
                  onOpenThread={() => setThreadRootId(message.id)}
                  onReact={(emoji) => reactMutation.mutate({ message, emoji })}
                />
              ))
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
            <Composer
              agents={agentsQuery.data ?? []}
              channel={activeChannel}
              sending={sendMutation.isPending}
              onSend={(content, mentions) =>
                sendMutation.mutate({ content, mentions })
              }
            />
          ) : null}
        </section>

        {threadRoot ? (
          <aside className="fixed inset-0 z-40 flex flex-col bg-[#f8f9f4] dark:bg-[#171916] md:static md:w-[24rem] md:border-l md:border-black/8 md:dark:border-white/8">
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/8 px-4 dark:border-white/8">
              <button
                aria-label="Close thread"
                className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
                type="button"
                onClick={() => setThreadRootId(null)}
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
              {[threadRoot, ...threadReplies].map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  ownPubkey={identity.pubkey}
                  profile={profileFor(message.pubkey)}
                  reactions={reactionsQuery.data?.get(message.id) ?? []}
                  replyCount={0}
                  onDelete={() => deleteMutation.mutate(message)}
                  onEdit={() => setEditingMessage(message)}
                  onOpenThread={() => {}}
                  onReact={(emoji) => reactMutation.mutate({ message, emoji })}
                />
              ))}
            </div>
            {activeChannel ? (
              <Composer
                agents={agentsQuery.data ?? []}
                channel={activeChannel}
                replyTo={threadRoot}
                sending={sendMutation.isPending}
                onSend={(content, mentions) =>
                  sendMutation.mutate({
                    content,
                    mentions,
                    replyTo:
                      threadReplies[threadReplies.length - 1] ?? threadRoot,
                  })
                }
              />
            ) : null}
          </aside>
        ) : null}
      </main>

      {createChannelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            className="w-full max-w-md rounded-2xl bg-[#fafbf6] p-6 shadow-xl dark:bg-[#20231e]"
            onSubmit={(event) => {
              event.preventDefault();
              createChannelMutation.mutate();
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-black/40 dark:text-white/35">
                  VarVik Studios
                </p>
                <h2 className="mt-1 text-xl font-semibold">Create a channel</h2>
              </div>
              <button
                aria-label="Close"
                className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
                type="button"
                onClick={() => setCreateChannelOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <label
              className="mb-2 mt-6 block text-sm font-medium"
              htmlFor="new-channel-name"
            >
              Name
            </label>
            <Input
              id="new-channel-name"
              autoFocus
              placeholder="project-launch"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
            />
            <label
              className="mb-2 mt-4 block text-sm font-medium"
              htmlFor="new-channel-description"
            >
              Description
            </label>
            <Input
              id="new-channel-description"
              placeholder="What belongs in this channel?"
              value={channelAbout}
              onChange={(event) => setChannelAbout(event.target.value)}
            />
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateChannelOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="bg-[#d7d72e] text-[#171912] hover:bg-[#e5e54d]"
                disabled={
                  !channelName.trim() || createChannelMutation.isPending
                }
                type="submit"
              >
                Create channel
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {editingMessage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            className="w-full max-w-lg rounded-2xl bg-[#fafbf6] p-6 shadow-xl dark:bg-[#20231e]"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              editMutation.mutate({
                message: editingMessage,
                content: String(data.get("content") ?? ""),
              });
            }}
          >
            <h2 className="text-lg font-semibold">Edit message</h2>
            <textarea
              className="mt-4 min-h-32 w-full rounded-xl border border-black/12 bg-transparent p-3 text-sm outline-none focus:border-[#b6b71e] dark:border-white/12"
              defaultValue={editingMessage.content}
              name="content"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingMessage(null)}
              >
                Cancel
              </Button>
              <Button
                className="bg-[#d7d72e] text-[#171912] hover:bg-[#e5e54d]"
                type="submit"
              >
                Save
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {settingsOpen ? (
        <WorkspaceSettings
          identity={identity}
          onClose={() => setSettingsOpen(false)}
          onSignOut={() => {
            lockBrowserIdentity();
            setIdentity(null);
            setSettingsOpen(false);
            queryClient.clear();
          }}
        />
      ) : null}

      {guideOpen ? (
        <WorkspaceGuide
          agents={agentsQuery.data ?? []}
          onClose={() => setGuideOpen(false)}
        />
      ) : null}
    </div>
  );
}

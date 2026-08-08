import {
  ChevronLeft,
  Hash,
  Lock,
  Menu,
  Settings2,
  Star,
  Users,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { IdentityGate } from "./IdentityGate";
import { EmptyMembership } from "./EmptyMembership";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { WorkspaceInbox } from "./WorkspaceInbox";
import { WorkspaceAgents } from "./WorkspaceAgents";
import { WorkspaceGuide } from "./WorkspaceGuide";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { WorkspaceComposer } from "./WorkspaceComposer";
import { WorkspaceMessageRow } from "./WorkspaceMessageRow";
import { WorkspaceChannelSettings } from "./WorkspaceChannelSettings";
import { shouldMountWorkspaceTheme } from "../workspace-theme-mount-policy";
import { useAgentMentionDelivery } from "../useAgentMentionDelivery";
import { useWorkspaceIdentity } from "../useWorkspaceIdentity";
import {
  type WorkspaceMessage,
  type WorkspaceProfile,
  createWorkspaceChannel,
  deleteWorkspaceMessage,
  editWorkspaceMessage,
  listAgents,
  listChannelMessages,
  listProfiles,
  listWorkspaceChannels,
  isConversationalWorkspaceMessage,
  publishWorkspaceProfile,
  subscribeToChannels,
} from "@/features/workspace/workspace-api";
import {
  materializeMessages,
  type TimelineMessage,
} from "@/features/workspace/workspace-messages";
import { useWorkspaceReactions } from "@/features/workspace/useWorkspaceReactions";
import { useWorkspaceReadState } from "@/features/workspace/workspace-read-state";
import { CommunityThemeController } from "@/shared/theme/CommunityThemeController";

type WorkspaceView = "agents" | "alerts" | "channel" | "inbox";

const STARRED_CHANNELS_STORAGE_PREFIX = "buzz.web.starred-channels.v1";

function starredChannelsStorageKey(pubkey: string) {
  return `${STARRED_CHANNELS_STORAGE_PREFIX}:${pubkey.toLowerCase()}`;
}

function readStarredChannels(pubkey: string) {
  if (!pubkey) return new Set<string>();
  try {
    const value = JSON.parse(
      localStorage.getItem(starredChannelsStorageKey(pubkey)) ?? "[]",
    );
    return new Set(
      Array.isArray(value)
        ? value.filter(
            (channelId): channelId is string =>
              typeof channelId === "string" && channelId.length > 0,
          )
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function WorkspacePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const {
    identity,
    identityLoading,
    lock: lockIdentity,
    setIdentity,
    setStoredIdentity,
    storedIdentity,
  } = useWorkspaceIdentity();
  const [activeChannelId, setActiveChannelId] = React.useState<string | null>(
    () => localStorage.getItem("buzz.web.active-channel"),
  );
  const [workspaceView, setWorkspaceView] =
    React.useState<WorkspaceView>("channel");
  const [starredChannelIds, setStarredChannelIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [threadRootId, setThreadRootId] = React.useState<string | null>(null);
  const [expandedThreadIds, setExpandedThreadIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const [createChannelOpen, setCreateChannelOpen] = React.useState(false);
  const [channelName, setChannelName] = React.useState("");
  const [channelAbout, setChannelAbout] = React.useState("");
  const [channelCatalogSection, setChannelCatalogSection] = React.useState("");
  const [channelVisibility, setChannelVisibility] = React.useState<
    "public" | "private"
  >("public");
  const [channelSettingsOpen, setChannelSettingsOpen] = React.useState(false);
  const [editingMessage, setEditingMessage] =
    React.useState<TimelineMessage | null>(null);

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
    setStarredChannelIds(readStarredChannels(identity?.pubkey ?? ""));
  }, [identity?.pubkey]);
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
  const { addAgentMutation, sendMutation } = useAgentMentionDelivery({
    activeChannel,
    activeChannelId,
    agents: agentsQuery.data ?? [],
    identity,
    refetchChannels: channelsQuery.refetch,
  });
  const messagesQuery = useQuery({
    queryKey: ["channel-messages", activeChannelId],
    queryFn: () => listChannelMessages(activeChannelId ?? ""),
    enabled: Boolean(activeChannelId),
  });
  const materialized = React.useMemo(
    () => materializeMessages(messagesQuery.data ?? []),
    [messagesQuery.data],
  );
  const {
    alertItems,
    dismissAllInboxItems,
    dismissInboxItem,
    inboxItems,
    markAllRead,
    markInboxItemRead,
    recordIncomingMessage,
    unreadChannelIds,
  } = useWorkspaceReadState({
    activeChannelId,
    channels,
    currentMessages: materialized,
    identityPubkey: identity?.pubkey,
  });
  const alertsUnreadCount = alertItems.filter((item) => !item.isRead).length;
  const inboxUnreadCount = inboxItems.filter((item) => !item.isRead).length;
  const toggleStarredChannel = React.useCallback(
    (channelId: string) => {
      if (!identity) return;
      setStarredChannelIds((current) => {
        const next = new Set(current);
        if (next.has(channelId)) next.delete(channelId);
        else next.add(channelId);
        localStorage.setItem(
          starredChannelsStorageKey(identity.pubkey),
          JSON.stringify([...next]),
        );
        return next;
      });
    },
    [identity],
  );
  const { reactionActorPubkeys, reactions, toggleReaction } =
    useWorkspaceReactions(materialized, identity?.pubkey ?? "");
  const profilePubkeys = React.useMemo(
    () => [
      ...(identity ? [identity.pubkey] : []),
      ...materialized.map((message) => message.pubkey),
      ...channels.flatMap((channel) => channel.memberPubkeys),
      ...(agentsQuery.data ?? []).map((agent) => agent.pubkey),
      ...reactionActorPubkeys,
    ],
    [agentsQuery.data, channels, identity, materialized, reactionActorPubkeys],
  );
  const profilesQuery = useQuery({
    queryKey: ["workspace-profiles", [...new Set(profilePubkeys)].sort()],
    queryFn: () => listProfiles(profilePubkeys),
    enabled: profilePubkeys.length > 0,
  });

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
        recordIncomingMessage(event);
        if (
          !isConversationalWorkspaceMessage(event) ||
          event.pubkey === identity.pubkey
        ) {
          return;
        }
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
  }, [channels, identity, queryClient, recordIncomingMessage]);

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

  const createChannelMutation = useMutation({
    mutationFn: () =>
      createWorkspaceChannel(channelName, channelAbout, {
        catalogSection: channelCatalogSection,
        visibility: channelVisibility,
      }),
    onSuccess: async () => {
      setCreateChannelOpen(false);
      setChannelName("");
      setChannelAbout("");
      setChannelCatalogSection("");
      setChannelVisibility("public");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      await channelsQuery.refetch();
    },
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
      <>
        {shouldMountWorkspaceTheme(identity.pubkey) ? (
          <CommunityThemeController pubkey={identity.pubkey} />
        ) : null}
        <EmptyMembership
          onJoined={async () => {
            await channelsQuery.refetch();
          }}
        />
      </>
    );
  }
  if (channelsQuery.isPending) {
    return (
      <>
        {shouldMountWorkspaceTheme(identity.pubkey) ? (
          <CommunityThemeController pubkey={identity.pubkey} />
        ) : null}
        <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f5ee] text-black/45 dark:bg-[#151713] dark:text-white/40">
          Connecting to VarVik Studios…
        </div>
      </>
    );
  }

  const profileFor = (pubkey: string): WorkspaceProfile =>
    agentsQuery.data?.find((profile) => profile.pubkey === pubkey) ??
    profilesQuery.data?.get(pubkey) ?? {
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
  const reactionActorName = (pubkey: string) =>
    pubkey === identity.pubkey ? "You" : profileFor(pubkey).name;
  const replyCounts = new Map<string, number>();
  const repliesByThread = new Map<string, TimelineMessage[]>();
  for (const message of materialized) {
    if (message.rootEventId) {
      replyCounts.set(
        message.rootEventId,
        (replyCounts.get(message.rootEventId) ?? 0) + 1,
      );
      const replies = repliesByThread.get(message.rootEventId) ?? [];
      replies.push(message);
      repliesByThread.set(message.rootEventId, replies);
    }
  }
  const toggleInlineThread = (messageId: string) => {
    setExpandedThreadIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };
  const openInlineThread = (messageId: string) => {
    setExpandedThreadIds((current) =>
      current.has(messageId) ? current : new Set(current).add(messageId),
    );
  };
  const closeInlineThread = (messageId: string) => {
    setExpandedThreadIds((current) => {
      if (!current.has(messageId)) return current;
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
  };

  return (
    <div
      className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground"
      data-testid="workspace-shell"
    >
      {shouldMountWorkspaceTheme(identity.pubkey) ? (
        <CommunityThemeController pubkey={identity.pubkey} />
      ) : null}
      <WorkspaceSidebar
        activeChannelId={activeChannelId}
        agents={agentsQuery.data ?? []}
        channels={channels}
        identity={identity}
        alertsUnreadCount={alertsUnreadCount}
        inboxUnreadCount={inboxUnreadCount}
        selectedView={workspaceView}
        profile={currentProfile}
        starredChannelIds={starredChannelIds}
        unreadChannelIds={unreadChannelIds}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCreateChannel={() => setCreateChannelOpen(true)}
        onAddAgent={(agent) => addAgentMutation.mutate(agent)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
        onOpenInbox={() => setWorkspaceView("inbox")}
        onOpenAlerts={() => setWorkspaceView("alerts")}
        onOpenAgents={() => setWorkspaceView("agents")}
        onToggleStar={toggleStarredChannel}
        onSelectChannel={(channelId) => {
          setActiveChannelId(channelId);
          setWorkspaceView("channel");
          setThreadRootId(null);
          setExpandedThreadIds(new Set());
        }}
      />

      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {workspaceView === "inbox" ? (
          <WorkspaceInbox
            channels={channels}
            items={inboxItems}
            onDismissAll={dismissAllInboxItems}
            onDismissItem={dismissInboxItem}
            onMarkItemRead={markInboxItemRead}
            onSelectItem={(item) => {
              if (!item.channelId) {
                markInboxItemRead(item);
                return;
              }
              markInboxItemRead(item);
              setActiveChannelId(item.channelId);
              setWorkspaceView("channel");
              setThreadRootId(null);
              setExpandedThreadIds(new Set());
            }}
            profileFor={profileFor}
          />
        ) : workspaceView === "alerts" ? (
          <WorkspaceInbox
            channels={channels}
            items={alertItems}
            mode="alerts"
            onDismissAll={markAllRead}
            onDismissItem={markInboxItemRead}
            onMarkItemRead={markInboxItemRead}
            onSelectItem={(item) => {
              if (!item.channelId) {
                markInboxItemRead(item);
                return;
              }
              markInboxItemRead(item);
              setActiveChannelId(item.channelId);
              setWorkspaceView("channel");
              setThreadRootId(null);
              setExpandedThreadIds(new Set());
            }}
            profileFor={profileFor}
          />
        ) : workspaceView === "agents" ? (
          <WorkspaceAgents
            activeChannel={activeChannel}
            agents={agentsQuery.data ?? []}
            onAddAgent={(agent) => addAgentMutation.mutate(agent)}
          />
        ) : (
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
                      {activeChannel.type !== "dm" ? (
                        <button
                          aria-label={`${starredChannelIds.has(activeChannel.id) ? "Remove" : "Add"} ${activeChannel.name} ${starredChannelIds.has(activeChannel.id) ? "from" : "to"} favorites`}
                          className="rounded-lg p-2 text-black/35 hover:bg-black/5 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/65"
                          type="button"
                          onClick={() => toggleStarredChannel(activeChannel.id)}
                        >
                          <Star
                            className={`size-4 ${starredChannelIds.has(activeChannel.id) ? "fill-current text-[#8b8c00] dark:text-[#e4e55e]" : ""}`}
                          />
                        </button>
                      ) : null}
                      {activeChannel.type !== "dm" ? (
                        <button
                          aria-label={`Manage ${activeChannel.name}`}
                          className="rounded-lg p-2 text-black/35 hover:bg-black/5 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/65"
                          type="button"
                          onClick={() => setChannelSettingsOpen(true)}
                        >
                          <Settings2 className="size-4" />
                        </button>
                      ) : null}
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
                  topLevel.map((message) => {
                    const replies = repliesByThread.get(message.id) ?? [];
                    const inlineExpanded = expandedThreadIds.has(message.id);
                    const replyTarget = replies[replies.length - 1] ?? message;
                    return (
                      <div key={message.id}>
                        <WorkspaceMessageRow
                          message={message}
                          ownPubkey={identity.pubkey}
                          profile={profileFor(message.pubkey)}
                          reactions={reactions?.get(message.id) ?? []}
                          replyCount={replyCounts.get(message.id) ?? 0}
                          reactionActorName={reactionActorName}
                          threadExpanded={inlineExpanded}
                          onDelete={() => {
                            if (window.confirm("Delete this message?")) {
                              deleteMutation.mutate(message);
                            }
                          }}
                          onEdit={() => setEditingMessage(message)}
                          onOpenThreadPanel={() => {
                            closeInlineThread(message.id);
                            setThreadRootId(message.id);
                          }}
                          onReact={(emoji) => toggleReaction(message, emoji)}
                          onReply={() => openInlineThread(message.id)}
                          onToggleInlineThread={() =>
                            toggleInlineThread(message.id)
                          }
                        />
                        {inlineExpanded ? (
                          <section
                            aria-label={`Replies to ${profileFor(message.pubkey).name}`}
                            className="mb-2 ml-10 border-l border-black/10 pl-2 dark:border-white/10 sm:ml-14 sm:pl-3"
                            data-testid={`inline-thread-${message.id}`}
                            id={`inline-thread-${message.id}`}
                          >
                            <p className="px-2 pt-2 text-xs font-medium text-black/40 dark:text-white/35">
                              {replies.length}{" "}
                              {replies.length === 1 ? "reply" : "replies"}
                            </p>
                            {replies.map((reply) => (
                              <WorkspaceMessageRow
                                key={reply.id}
                                message={reply}
                                ownPubkey={identity.pubkey}
                                profile={profileFor(reply.pubkey)}
                                reactions={reactions?.get(reply.id) ?? []}
                                replyCount={0}
                                reactionActorName={reactionActorName}
                                onDelete={() => deleteMutation.mutate(reply)}
                                onEdit={() => setEditingMessage(reply)}
                                onOpenThreadPanel={() =>
                                  setThreadRootId(message.id)
                                }
                                onReact={(emoji) =>
                                  toggleReaction(reply, emoji)
                                }
                                onReply={() => openInlineThread(message.id)}
                                onToggleInlineThread={() => {}}
                              />
                            ))}
                            {activeChannel ? (
                              <WorkspaceComposer
                                agents={agentsQuery.data ?? []}
                                channel={activeChannel}
                                compact
                                replyTo={replyTarget}
                                sending={sendMutation.isPending}
                                onCancelReply={() =>
                                  closeInlineThread(message.id)
                                }
                                onSend={(content, mentions) =>
                                  sendMutation.mutate({
                                    content,
                                    mentions,
                                    replyTo: replyTarget,
                                  })
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
                        Share an update or mention a hosted agent to give it
                        work.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {activeChannel ? (
                <WorkspaceComposer
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
                    <WorkspaceMessageRow
                      key={message.id}
                      message={message}
                      ownPubkey={identity.pubkey}
                      profile={profileFor(message.pubkey)}
                      reactions={reactions?.get(message.id) ?? []}
                      replyCount={0}
                      reactionActorName={reactionActorName}
                      onDelete={() => deleteMutation.mutate(message)}
                      onEdit={() => setEditingMessage(message)}
                      onOpenThreadPanel={() => {}}
                      onReact={(emoji) => toggleReaction(message, emoji)}
                      onReply={() => {}}
                      onToggleInlineThread={() => {}}
                    />
                  ))}
                </div>
                {activeChannel ? (
                  <WorkspaceComposer
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
          </>
        )}
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
              htmlFor="new-channel-section"
            >
              Catalog section
            </label>
            <Input
              id="new-channel-section"
              maxLength={80}
              placeholder="e.g. Command Center"
              value={channelCatalogSection}
              onChange={(event) => setChannelCatalogSection(event.target.value)}
            />
            <label
              className="mb-2 mt-4 block text-sm font-medium"
              htmlFor="new-channel-visibility"
            >
              Visibility
            </label>
            <select
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              id="new-channel-visibility"
              value={channelVisibility}
              onChange={(event) =>
                setChannelVisibility(event.target.value as "public" | "private")
              }
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
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
            lockIdentity();
            setSettingsOpen(false);
            queryClient.clear();
          }}
        />
      ) : null}

      {channelSettingsOpen && activeChannel ? (
        <WorkspaceChannelSettings
          channel={activeChannel}
          viewerPubkey={identity.pubkey}
          onClose={() => setChannelSettingsOpen(false)}
          onUpdated={async () => {
            return (await channelsQuery.refetch()).data ?? [];
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { IdentityGate } from "./IdentityGate";
import { EmptyMembership } from "./EmptyMembership";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { WorkspaceInbox } from "./WorkspaceInbox";
import { WorkspaceAgents } from "./WorkspaceAgents";
import { WorkspaceGuide } from "./WorkspaceGuide";
import { WorkspaceConversation } from "./WorkspaceConversation";
import { WorkspaceContentDialogs } from "./WorkspaceContentDialogs";
import { WorkspaceChannelSettings } from "./WorkspaceChannelSettings";
import { WorkspaceNewMessage } from "./WorkspaceNewMessage";
import { RemindersPanel } from "@/features/reminders/ui/RemindersPanel";
import { useCustomEmojiPalette } from "@/features/custom-emoji/custom-emoji-api";
import {
  addDirectMessageMembers,
  hideDirectMessage,
  openDirectMessage,
  useDmVisibility,
} from "../dm-visibility";
import {
  useChannelTyping,
  usePresenceHeartbeat,
  useTypingBroadcast,
  useWorkspacePresence,
} from "@/features/presence/workspace-presence";
import { useAgentMentionDelivery } from "../useAgentMentionDelivery";
import { useWorkspaceIdentity } from "../useWorkspaceIdentity";
import { useSyncedChannelState } from "@/features/channel-state/useSyncedChannelState";
import { readBrowserPreferences } from "@/features/preferences/browser-preferences";
import {
  type WorkspaceMessage,
  type WorkspaceProfile,
  addWorkspaceMember,
  createWorkspaceChannel,
  deleteWorkspaceMessage,
  editWorkspaceMessage,
  listAgents,
  listChannelMessages,
  listProfiles,
  listWorkspaceCommunityMembers,
  listWorkspaceChannels,
  publishHostedAgentConfig,
  isConversationalWorkspaceMessage,
  publishWorkspaceProfile,
  removeWorkspaceMember,
  sendWorkspaceMessage,
  subscribeToChannels,
  subscribeToWorkspaceChannelCatalog,
  subscribeToWorkspaceDirectory,
  subscribeToWorkspaceMembershipChanges,
} from "@/features/workspace/workspace-api";
import {
  materializeMessages,
  type TimelineMessage,
} from "@/features/workspace/workspace-messages";
import { useWorkspaceReactions } from "@/features/workspace/useWorkspaceReactions";
import { useWorkspaceReadState } from "@/features/workspace/workspace-read-state";
import { workspaceInvalidationTargets } from "../workspace-realtime-sync-policy";
import {
  listUserStatuses,
  subscribeToProfiles,
  subscribeToUserStatuses,
} from "@/features/profiles/profile-api";

type WorkspaceView = "agents" | "alerts" | "channel" | "inbox";

export function WorkspacePage({
  routeMode = "workspace",
  channelPermalink,
  threadPermalink,
}: {
  routeMode?: "workspace" | "new-message" | "reminders";
  channelPermalink?: string;
  threadPermalink?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const {
    identity,
    identityLoading,
    setIdentity,
    setStoredIdentity,
    storedIdentity,
  } = useWorkspaceIdentity();
  const [activeChannelId, setActiveChannelId] = React.useState<string | null>(
    () => localStorage.getItem("buzz.web.active-channel"),
  );
  const [workspaceView, setWorkspaceView] = React.useState<WorkspaceView>(
    () => {
      const requested = new URLSearchParams(window.location.search).get("view");
      return requested === "agents" ||
        requested === "alerts" ||
        requested === "inbox"
        ? requested
        : "channel";
    },
  );
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [threadRootId, setThreadRootId] = React.useState<string | null>(null);
  const [expandedThreadIds, setExpandedThreadIds] = React.useState<Set<string>>(
    () => new Set(),
  );
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
  const [addingDmMembers, setAddingDmMembers] = React.useState(false);
  const [dmMemberQuery, setDmMemberQuery] = React.useState("");
  const hiddenDmChannelIds = useDmVisibility(identity?.pubkey);
  const {
    mutedChannelIds,
    starredChannelIds,
    toggleMute: toggleMutedChannel,
    toggleStar: toggleStarredChannel,
  } = useSyncedChannelState(identity?.pubkey);

  const channelsQuery = useQuery({
    queryKey: ["workspace-channels", identity?.pubkey],
    queryFn: () => listWorkspaceChannels(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    retry: false,
  });
  const agentsQuery = useQuery({
    queryKey: ["workspace-agents", identity?.pubkey],
    queryFn: () => listAgents(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    retry: false,
  });
  const communityMembersQuery = useQuery({
    queryKey: ["workspace-community-members"],
    queryFn: listWorkspaceCommunityMembers,
    enabled: Boolean(identity),
    retry: false,
  });

  const channels = channelsQuery.data ?? [];
  const visibleChannels = React.useMemo(
    () =>
      channels.filter(
        (channel) =>
          channel.type !== "dm" ||
          !hiddenDmChannelIds.has(channel.id.toLowerCase()),
      ),
    [channels, hiddenDmChannelIds],
  );
  const recipientProfilesQuery = useQuery({
    queryKey: [
      "workspace-dm-recipient-profiles",
      communityMembersQuery.data?.map((member) => member.pubkey).sort(),
    ],
    queryFn: () =>
      listProfiles(
        communityMembersQuery.data?.map((member) => member.pubkey) ?? [],
      ),
    enabled: Boolean(identity && communityMembersQuery.data?.length),
  });
  React.useEffect(() => {
    if (
      visibleChannels.length &&
      !visibleChannels.some((channel) => channel.id === activeChannelId)
    ) {
      setActiveChannelId(visibleChannels[0]?.id ?? null);
    }
  }, [activeChannelId, visibleChannels]);
  React.useEffect(() => {
    if (
      channelPermalink &&
      visibleChannels.some((channel) => channel.id === channelPermalink)
    ) {
      setActiveChannelId(channelPermalink);
      setWorkspaceView("channel");
    }
  }, [channelPermalink, visibleChannels]);
  React.useEffect(() => {
    if (!threadPermalink || !/^[0-9a-f]{64}$/i.test(threadPermalink)) return;
    setThreadRootId(threadPermalink);
    setWorkspaceView("channel");
  }, [threadPermalink]);
  React.useEffect(() => {
    if (activeChannelId) {
      localStorage.setItem("buzz.web.active-channel", activeChannelId);
    }
  }, [activeChannelId]);

  const activeChannel =
    visibleChannels.find((channel) => channel.id === activeChannelId) ?? null;
  const presenceByPubkey = useWorkspacePresence(
    identity?.pubkey,
    activeChannel?.memberPubkeys ?? [],
  );
  usePresenceHeartbeat(identity?.pubkey);
  const typingPubkeys = useChannelTyping(
    activeChannel?.id ?? null,
    identity?.pubkey,
    activeChannel?.memberPubkeys ?? [],
  );
  const notifyTyping = useTypingBroadcast(activeChannel?.id ?? null);
  const { addAgentMutation, sendMutation } = useAgentMentionDelivery({
    activeChannel,
    activeChannelId,
    agents: agentsQuery.data ?? [],
    identity,
  });
  const updateAgentMutation = useMutation({
    mutationFn: async ({
      agent,
      update,
    }: {
      agent: WorkspaceProfile;
      update: {
        name: string;
        avatarUrl: string | null;
        model: string | null;
      };
    }) =>
      publishHostedAgentConfig({
        pubkey: agent.pubkey,
        ...update,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-agents"] });
    },
  });
  const channelAccessMutation = useMutation({
    mutationFn: async ({
      agent,
      channel,
      enabled,
    }: {
      agent: WorkspaceProfile;
      channel: (typeof channels)[number];
      enabled: boolean;
    }) => {
      if (enabled) return addWorkspaceMember(channel.id, agent.pubkey, "bot");
      return removeWorkspaceMember(channel.id, agent.pubkey);
    },
    onMutate: async ({ agent, channel, enabled }) => {
      const queryKey = ["workspace-channels", identity?.pubkey] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<typeof channels>(queryKey);
      queryClient.setQueryData<typeof channels>(queryKey, (current = []) =>
        current.map((candidate) =>
          candidate.id !== channel.id
            ? candidate
            : {
                ...candidate,
                memberPubkeys: enabled
                  ? [...new Set([...candidate.memberPubkeys, agent.pubkey])]
                  : candidate.memberPubkeys.filter(
                      (pubkey) => pubkey !== agent.pubkey,
                    ),
              },
        ),
      );
      return { previous, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-channels"] });
    },
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
    unreadChannelCounts,
  } = useWorkspaceReadState({
    activeChannelId,
    channels,
    currentMessages: materialized,
    identityPubkey: identity?.pubkey,
  });
  const alertsUnreadCount = alertItems.filter((item) => !item.isRead).length;
  const inboxUnreadCount = inboxItems.filter((item) => !item.isRead).length;
  const emojiMemberPubkeys = React.useMemo(
    () => [
      ...(identity ? [identity.pubkey] : []),
      ...channels.flatMap((channel) => channel.memberPubkeys),
    ],
    [channels, identity],
  );
  const customEmojiQuery = useCustomEmojiPalette(emojiMemberPubkeys);
  const customEmoji = customEmojiQuery.data ?? [];
  const { reactionActorPubkeys, reactions, toggleReaction } =
    useWorkspaceReactions(materialized, identity?.pubkey ?? "", customEmoji);
  const profilePubkeys = React.useMemo(
    () =>
      [
        ...(identity ? [identity.pubkey] : []),
        ...materialized.map((message) => message.pubkey),
        ...channels.flatMap((channel) => channel.memberPubkeys),
        ...(agentsQuery.data ?? []).map((agent) => agent.pubkey),
        ...reactionActorPubkeys,
      ]
        .map((pubkey) => pubkey.toLowerCase())
        .filter((pubkey) => /^[0-9a-f]{64}$/.test(pubkey))
        .filter((pubkey, index, values) => values.indexOf(pubkey) === index)
        .sort(),
    [agentsQuery.data, channels, identity, materialized, reactionActorPubkeys],
  );
  const profilesQuery = useQuery({
    queryKey: ["workspace-profiles", profilePubkeys],
    queryFn: () => listProfiles(profilePubkeys),
    enabled: profilePubkeys.length > 0,
  });
  const userStatusesQuery = useQuery({
    queryKey: ["user-status", ...profilePubkeys],
    queryFn: () => listUserStatuses(profilePubkeys),
    enabled: profilePubkeys.length > 0,
    staleTime: 60_000,
  });
  const profilePubkeyKey = profilePubkeys.join(",");

  React.useEffect(() => {
    const renderedPubkeys = profilePubkeyKey ? profilePubkeyKey.split(",") : [];
    if (!renderedPubkeys.length) return;
    const stopProfiles = subscribeToProfiles(renderedPubkeys, () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-profiles"] });
    });
    const stopStatuses = subscribeToUserStatuses(renderedPubkeys, () => {
      void queryClient.invalidateQueries({ queryKey: ["user-status"] });
    });
    return () => {
      stopProfiles();
      stopStatuses();
    };
  }, [profilePubkeyKey, queryClient]);

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
          readBrowserPreferences(identity.pubkey).notifications &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification(`New message in #${channel.name}`, {
            body:
              event.content.length > 180
                ? `${event.content.slice(0, 177)}…`
                : event.content,
            tag: `buzz-channel-${event.channelId}`,
            silent: !readBrowserPreferences(identity.pubkey).notificationSound,
          });
        }
      },
    );
  }, [channels, identity, queryClient, recordIncomingMessage]);

  React.useEffect(() => {
    if (!identity) return;
    const viewerPubkey = identity.pubkey;
    const pending = new Set<"channels" | "agents">();
    let flushTimer: number | null = null;
    const invalidate = (event: { kind: number; tags: string[][] }) => {
      for (const target of workspaceInvalidationTargets(event, viewerPubkey)) {
        pending.add(target);
      }
      if (pending.size === 0 || flushTimer !== null) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        if (pending.delete("channels")) {
          void queryClient.invalidateQueries({
            queryKey: ["workspace-channels", viewerPubkey],
          });
        }
        if (pending.delete("agents")) {
          void queryClient.invalidateQueries({
            queryKey: ["workspace-agents", viewerPubkey],
          });
        }
      }, 0);
    };
    const stopCatalog = subscribeToWorkspaceChannelCatalog(invalidate);
    const stopDirectory = subscribeToWorkspaceDirectory(invalidate);
    const stopMembership = subscribeToWorkspaceMembershipChanges(
      viewerPubkey,
      invalidate,
    );
    return () => {
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      stopCatalog();
      stopDirectory();
      stopMembership();
    };
  }, [identity, queryClient]);

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
    onSuccess: () => {
      setCreateChannelOpen(false);
      setChannelName("");
      setChannelAbout("");
      setChannelCatalogSection("");
      setChannelVisibility("public");
      void queryClient.invalidateQueries({
        queryKey: ["workspace-channels", identity?.pubkey],
      });
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
  const openDmMutation = useMutation({
    mutationFn: async ({
      recipients,
      content,
    }: {
      recipients: string[];
      content: string;
    }) => {
      if (!identity)
        throw new Error("Sign in before opening a direct message.");
      await openDirectMessage(recipients);
      const refreshed = (await channelsQuery.refetch()).data ?? [];
      const participantSet = new Set(
        [identity.pubkey, ...recipients].map((pubkey) => pubkey.toLowerCase()),
      );
      const directMessage = refreshed.find((channel) => {
        const members = new Set(
          channel.memberPubkeys.map((pubkey) => pubkey.toLowerCase()),
        );
        return (
          channel.type === "dm" &&
          members.size === participantSet.size &&
          [...participantSet].every((pubkey) => members.has(pubkey))
        );
      });
      if (!directMessage) {
        throw new Error(
          "The conversation opened, but is still syncing. Try again in a moment.",
        );
      }
      if (content.trim()) await sendWorkspaceMessage(directMessage.id, content);
      return directMessage.id;
    },
    onSuccess: (channelId) => {
      setActiveChannelId(channelId);
      setWorkspaceView("channel");
      void navigate({ to: "/messages/$channelId", params: { channelId } });
    },
  });
  const hideDmMutation = useMutation({
    mutationFn: hideDirectMessage,
    onSuccess: () => {
      setActiveChannelId(null);
      setThreadRootId(null);
      void navigate({ to: "/" });
    },
  });
  const addDmMemberMutation = useMutation({
    mutationFn: ({
      channelId,
      pubkey,
    }: {
      channelId: string;
      pubkey: string;
    }) => addDirectMessageMembers(channelId, [pubkey]),
    onSuccess: async () => {
      setAddingDmMembers(false);
      setDmMemberQuery("");
      await channelsQuery.refetch();
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
  const statusFor = (pubkey: string) =>
    userStatusesQuery.data?.get(pubkey.toLowerCase()) ?? null;
  const typingNames = typingPubkeys.map((pubkey) => profileFor(pubkey).name);
  const onlineMemberCount = activeChannel
    ? activeChannel.memberPubkeys.filter(
        (pubkey) => presenceByPubkey[pubkey.toLowerCase()] === "online",
      ).length
    : 0;
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
      <WorkspaceSidebar
        activeChannelId={activeChannelId}
        agents={agentsQuery.data ?? []}
        channels={visibleChannels}
        hiddenDirectMessages={channels.filter(
          (channel) =>
            channel.type === "dm" &&
            hiddenDmChannelIds.has(channel.id.toLowerCase()),
        )}
        identity={identity}
        alertsUnreadCount={alertsUnreadCount}
        inboxUnreadCount={inboxUnreadCount}
        selectedView={workspaceView}
        profile={currentProfile}
        starredChannelIds={starredChannelIds}
        unreadChannelCounts={unreadChannelCounts}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCreateChannel={() => setCreateChannelOpen(true)}
        onAddAgent={(agent) => addAgentMutation.mutate(agent)}
        onOpenGuide={() => setGuideOpen(true)}
        onOpenInbox={() => setWorkspaceView("inbox")}
        onOpenAlerts={() => setWorkspaceView("alerts")}
        onOpenAgents={() => setWorkspaceView("agents")}
        onNewMessage={() => void navigate({ to: "/messages/new" })}
        onOpenReminders={() => void navigate({ to: "/reminders" })}
        onReopenDirectMessage={(channel) =>
          openDmMutation.mutate({
            recipients: channel.memberPubkeys.filter(
              (pubkey) =>
                pubkey.toLowerCase() !== identity.pubkey.toLowerCase(),
            ),
            content: "",
          })
        }
        onToggleStar={toggleStarredChannel}
        onSelectChannel={(channelId) => {
          setActiveChannelId(channelId);
          setWorkspaceView("channel");
          setThreadRootId(null);
          setExpandedThreadIds(new Set());
        }}
      />

      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {routeMode === "new-message" ? (
          <WorkspaceNewMessage
            error={
              openDmMutation.error instanceof Error
                ? openDmMutation.error
                : null
            }
            members={(communityMembersQuery.data ?? []).filter(
              (member) =>
                member.pubkey.toLowerCase() !== identity.pubkey.toLowerCase(),
            )}
            opening={openDmMutation.isPending}
            profiles={recipientProfilesQuery.data}
            onBack={() => void navigate({ to: "/" })}
            onOpen={(recipients, content) =>
              openDmMutation.mutate({ recipients, content })
            }
          />
        ) : routeMode === "reminders" ? (
          <RemindersPanel
            pubkey={identity.pubkey}
            onBack={() => void navigate({ to: "/" })}
            onOpenTarget={(reminder) => {
              const channelId = reminder.content.target?.channelId;
              if (!channelId) return;
              void navigate({
                to: "/messages/$channelId",
                params: { channelId },
              });
            }}
          />
        ) : workspaceView === "inbox" ? (
          <WorkspaceInbox
            channels={visibleChannels}
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
            channels={visibleChannels}
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
            channels={channels}
            canManage={Boolean(
              communityMembersQuery.data?.some(
                (member) =>
                  member.pubkey === identity.pubkey &&
                  (member.role === "owner" || member.role === "admin"),
              ),
            )}
            busy={
              updateAgentMutation.isPending || channelAccessMutation.isPending
            }
            error={
              updateAgentMutation.error instanceof Error
                ? updateAgentMutation.error.message
                : channelAccessMutation.error instanceof Error
                  ? channelAccessMutation.error.message
                  : null
            }
            onAddAgent={(agent) => addAgentMutation.mutate(agent)}
            onSetChannelAccess={async (agent, channel, enabled) => {
              await channelAccessMutation.mutateAsync({
                agent,
                channel,
                enabled,
              });
            }}
            onUpdateAgent={async (agent, update) => {
              await updateAgentMutation.mutateAsync({ agent, update });
            }}
          />
        ) : (
          <WorkspaceConversation
            activeChannel={activeChannel}
            agents={agentsQuery.data ?? []}
            customEmoji={customEmoji}
            expandedThreadIds={expandedThreadIds}
            hideDirectMessagePending={hideDmMutation.isPending}
            messagesPending={messagesQuery.isPending}
            onlineMemberCount={onlineMemberCount}
            ownPubkey={identity.pubkey}
            reactionActorName={reactionActorName}
            reactions={reactions}
            repliesByThread={repliesByThread}
            replyCounts={replyCounts}
            sendPending={sendMutation.isPending}
            mutedChannelIds={mutedChannelIds}
            starredChannelIds={starredChannelIds}
            statusFor={statusFor}
            threadReplies={threadReplies}
            threadRoot={threadRoot}
            topLevel={topLevel}
            typingNames={typingNames}
            profileFor={profileFor}
            onAddDmMembers={() => setAddingDmMembers(true)}
            onCloseInlineThread={closeInlineThread}
            onDeleteMessage={(message) => deleteMutation.mutate(message)}
            onEditMessage={setEditingMessage}
            onHideDirectMessage={() => {
              if (activeChannel) hideDmMutation.mutate(activeChannel.id);
            }}
            onOpenNavigation={() => setSidebarOpen(true)}
            onOpenThreadPanel={(messageId) => {
              closeInlineThread(messageId);
              setThreadRootId(messageId);
            }}
            onReply={openInlineThread}
            onSend={(content, mentions, mediaTags, replyTo) =>
              sendMutation.mutate({ content, mentions, mediaTags, replyTo })
            }
            onSetChannelSettingsOpen={() => setChannelSettingsOpen(true)}
            onSetThreadRoot={setThreadRootId}
            onToggleInlineThread={toggleInlineThread}
            onToggleReaction={toggleReaction}
            onToggleMute={toggleMutedChannel}
            onToggleStar={toggleStarredChannel}
            onTyping={notifyTyping}
          />
        )}
      </main>

      <WorkspaceContentDialogs
        activeChannel={activeChannel}
        addingDmMembers={addingDmMembers}
        addDmMemberError={
          addDmMemberMutation.error instanceof Error
            ? addDmMemberMutation.error.message
            : null
        }
        addDmMemberPending={addDmMemberMutation.isPending}
        channelAbout={channelAbout}
        channelCatalogSection={channelCatalogSection}
        channelName={channelName}
        channelVisibility={channelVisibility}
        communityMembers={communityMembersQuery.data ?? []}
        createChannelOpen={createChannelOpen}
        creatingChannel={createChannelMutation.isPending}
        dmMemberQuery={dmMemberQuery}
        editingMessage={editingMessage}
        recipientProfiles={recipientProfilesQuery.data}
        onAddDmMember={(channelId, pubkey) =>
          addDmMemberMutation.mutate({ channelId, pubkey })
        }
        onCloseAddDmMembers={() => setAddingDmMembers(false)}
        onCloseCreateChannel={() => setCreateChannelOpen(false)}
        onCloseEditMessage={() => setEditingMessage(null)}
        onCreateChannel={() => createChannelMutation.mutate()}
        onSaveEditMessage={(message, content) =>
          editMutation.mutate({ message, content })
        }
        onSetChannelAbout={setChannelAbout}
        onSetChannelCatalogSection={setChannelCatalogSection}
        onSetChannelName={setChannelName}
        onSetChannelVisibility={setChannelVisibility}
        onSetDmMemberQuery={setDmMemberQuery}
      />
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

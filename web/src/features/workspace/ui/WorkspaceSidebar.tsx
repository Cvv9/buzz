import {
  Bell,
  Bot,
  BookOpen,
  Check,
  ChevronRight,
  Hash,
  Inbox,
  Lock,
  MessageCircle,
  Plus,
  Settings,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { makeBlossomGetAuthHeader } from "@/shared/lib/blossom-auth";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import type {
  WorkspaceChannel,
  WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import type { BrowserIdentity } from "@/shared/lib/browser-identity";

const SECTION_STORAGE_PREFIX = "buzz-web:channel-sections:v1";

type ChannelSectionId = string;
type AgentSectionId = "hostedAgents" | "privateAgents" | "sharedAgents";
type CollapsibleSectionId = ChannelSectionId | AgentSectionId;
type CollapsedSections = Record<CollapsibleSectionId, boolean>;

function sectionStorageKey(pubkey: string): string {
  return `${SECTION_STORAGE_PREFIX}:${pubkey}`;
}

function readCollapsedSections(pubkey: string): CollapsedSections {
  const fallback = {
    favorites: false,
    hostedAgents: false,
    privateAgents: false,
    sharedAgents: false,
  };
  try {
    const stored = window.localStorage.getItem(sectionStorageKey(pubkey));
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries({ ...fallback, ...parsed }).map(([section, collapsed]) => [
        section,
        collapsed === true,
      ]),
    );
  } catch {
    return fallback;
  }
}

export function isProjectChannel(channel: WorkspaceChannel): boolean {
  return Boolean(channel.catalogSection.trim());
}

export function profileInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ProfileAvatar({
  profile,
  size = "md",
}: {
  profile: WorkspaceProfile;
  size?: "sm" | "md";
}) {
  const picture = useAuthenticatedPicture(profile.picture);
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#d7d72e]/18 font-semibold text-[#969600]",
        size === "sm" ? "size-7 text-[0.6875rem]" : "size-9 text-xs",
      )}
    >
      {picture ? (
        <img alt="" className="size-full object-cover" src={picture} />
      ) : profile.isAgent ? (
        <Bot className={size === "sm" ? "size-3.5" : "size-4"} />
      ) : (
        profileInitials(profile.name)
      )}
      {profile.isAgent ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-[#d7d72e] text-[#171912]"
          title="AI agent"
        >
          <Sparkles className="size-2" />
        </span>
      ) : null}
    </div>
  );
}

function useAuthenticatedPicture(source?: string): string | undefined {
  const [resolved, setResolved] = useState<string>();

  useEffect(() => {
    if (!source) {
      setResolved(undefined);
      return;
    }

    let url: URL;
    try {
      url = new URL(source, window.location.origin);
    } catch {
      setResolved(undefined);
      return;
    }

    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith("/media/")
    ) {
      setResolved(url.href);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | undefined;
    setResolved(undefined);
    void (async () => {
      try {
        const response = await fetch(url.href, {
          headers: {
            Authorization: await makeBlossomGetAuthHeader(url.href, {
              requireDurableSigner: true,
            }),
          },
          signal: controller.signal,
        });
        if (!response.ok) return;
        objectUrl = URL.createObjectURL(await response.blob());
        setResolved(objectUrl);
      } catch {
        // Keep the initials/bot fallback when the image cannot be authorized.
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  return resolved;
}

export function WorkspaceSidebar({
  identity,
  profile,
  inboxUnreadCount,
  alertsUnreadCount,
  selectedView,
  unreadChannelIds,
  channels,
  agents,
  activeChannelId,
  open,
  onClose,
  onSelectChannel,
  onCreateChannel,
  onOpenSettings,
  onOpenGuide,
  onOpenInbox,
  onOpenAlerts,
  onOpenAgents,
  onAddAgent,
  starredChannelIds,
  onToggleStar,
}: {
  identity: BrowserIdentity;
  profile: WorkspaceProfile;
  inboxUnreadCount: number;
  alertsUnreadCount: number;
  selectedView: "agents" | "alerts" | "channel" | "inbox";
  unreadChannelIds: ReadonlySet<string>;
  channels: WorkspaceChannel[];
  agents: WorkspaceProfile[];
  activeChannelId: string | null;
  open: boolean;
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onOpenInbox: () => void;
  onOpenAlerts: () => void;
  onOpenAgents: () => void;
  onAddAgent: (agent: WorkspaceProfile) => void;
  starredChannelIds: ReadonlySet<string>;
  onToggleStar: (channelId: string) => void;
}) {
  const streams = channels.filter((channel) => channel.type !== "dm");
  const directMessages = channels.filter((channel) => channel.type === "dm");
  const favoriteChannels = streams.filter((channel) =>
    starredChannelIds.has(channel.id),
  );
  const catalogSections = [...streams]
    .filter((channel) => !starredChannelIds.has(channel.id))
    .reduce<Map<string, WorkspaceChannel[]>>((sections, channel) => {
      const section = channel.catalogSection.trim() || "Channels";
      const entries = sections.get(section) ?? [];
      entries.push(channel);
      sections.set(section, entries);
      return sections;
    }, new Map());
  const privateAgents = agents.filter(
    (agent) => agent.accessTier === "personal" || agent.accessTier === "admin",
  );
  const sharedAgents = agents.filter(
    (agent) => agent.accessTier !== "personal" && agent.accessTier !== "admin",
  );
  const [collapsedSections, setCollapsedSections] = useState<CollapsedSections>(
    () => readCollapsedSections(identity.pubkey),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        sectionStorageKey(identity.pubkey),
        JSON.stringify(collapsedSections),
      );
    } catch {
      // The sidebar remains functional when browser storage is unavailable.
    }
  }, [collapsedSections, identity.pubkey]);

  useEffect(() => {
    const activeChannel = channels.find(
      (channel) => channel.id === activeChannelId,
    );
    if (!activeChannel) return;
    const section: ChannelSectionId =
      activeChannel.catalogSection.trim() || "Channels";
    setCollapsedSections((current) =>
      current[section] ? { ...current, [section]: false } : current,
    );
  }, [activeChannelId, channels]);

  const toggleSection = (section: CollapsibleSectionId) => {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const selectChannel = (channelId: string) => {
    onSelectChannel(channelId);
    onClose();
  };

  return (
    <>
      {open ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          type="button"
          onClick={onClose}
        />
      ) : null}
      <aside
        data-testid="workspace-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-dvh min-h-0 w-[17rem] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:static md:h-full md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <header className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-black text-primary-foreground">
              V
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">VarVik Studios</p>
              <p className="truncate text-xs text-muted-foreground">
                {identity.displayName}
              </p>
            </div>
          </div>
          <button
            aria-label="Close navigation"
            className="rounded-lg p-2 hover:bg-sidebar-accent md:hidden"
            type="button"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <nav
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
          data-testid="workspace-sidebar-scroll"
        >
          <div className="mb-4 space-y-0.5">
            <button
              aria-label={
                inboxUnreadCount
                  ? `Inbox, ${inboxUnreadCount} unread notifications`
                  : "Inbox"
              }
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                selectedView === "inbox"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent",
              )}
              data-testid="workspace-inbox-button"
              type="button"
              onClick={() => {
                onOpenInbox();
                onClose();
              }}
            >
              <Inbox className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Inbox</span>
              {inboxUnreadCount ? (
                <span className="min-w-5 rounded-full bg-orange-500 px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold tabular-nums text-white">
                  {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                </span>
              ) : null}
            </button>
            <button
              aria-label={
                alertsUnreadCount
                  ? `Alerts, ${alertsUnreadCount} unread notifications`
                  : "Alerts"
              }
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                selectedView === "alerts"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent",
              )}
              data-testid="workspace-alerts-button"
              type="button"
              onClick={() => {
                onOpenAlerts();
                onClose();
              }}
            >
              <Bell className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Alerts</span>
              {alertsUnreadCount ? (
                <span className="min-w-5 rounded-full bg-orange-500 px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold tabular-nums text-white">
                  {alertsUnreadCount > 99 ? "99+" : alertsUnreadCount}
                </span>
              ) : null}
            </button>
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                selectedView === "agents"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent",
              )}
              data-testid="workspace-agents-button"
              type="button"
              onClick={() => {
                onOpenAgents();
                onClose();
              }}
            >
              <Bot className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Agents</span>
            </button>
          </div>
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-xs font-semibold text-muted-foreground">
                Channels
              </p>
              <button
                aria-label="Create channel"
                className="rounded-md p-1 hover:bg-sidebar-accent"
                type="button"
                onClick={onCreateChannel}
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {favoriteChannels.length ? (
                <ChannelSection
                  activeChannelId={activeChannelId}
                  channels={favoriteChannels}
                  collapsed={collapsedSections.favorites}
                  id="favorites"
                  label="Favorites"
                  onSelectChannel={selectChannel}
                  onToggle={() => toggleSection("favorites")}
                  onToggleStar={onToggleStar}
                  starredChannelIds={starredChannelIds}
                  unreadChannelIds={unreadChannelIds}
                />
              ) : null}
              {[...catalogSections.entries()].map(
                ([section, sectionChannels]) => (
                  <ChannelSection
                    activeChannelId={activeChannelId}
                    channels={sectionChannels}
                    collapsed={collapsedSections[section] === true}
                    id={section}
                    key={section}
                    label={section}
                    onSelectChannel={selectChannel}
                    onToggle={() => toggleSection(section)}
                    onToggleStar={onToggleStar}
                    starredChannelIds={starredChannelIds}
                    unreadChannelIds={unreadChannelIds}
                  />
                ),
              )}
            </div>
          </div>

          {directMessages.length ? (
            <div className="mb-6">
              <p className="mb-2 px-2 text-xs font-semibold text-muted-foreground">
                Direct messages
              </p>
              <div className="space-y-0.5">
                {directMessages.map((channel) => (
                  <ChannelButton
                    active={activeChannelId === channel.id}
                    channel={channel}
                    key={channel.id}
                    unread={unreadChannelIds.has(channel.id)}
                    starred={starredChannelIds.has(channel.id)}
                    onToggleStar={() => onToggleStar(channel.id)}
                    onSelect={() => {
                      onSelectChannel(channel.id);
                      onClose();
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <section>
            <button
              aria-controls="hosted-agents-content"
              aria-expanded={!collapsedSections.hostedAgents}
              className="mb-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-semibold text-black/45 hover:bg-black/4 hover:text-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white/60"
              data-testid="hosted-agents-toggle"
              type="button"
              onClick={() => toggleSection("hostedAgents")}
            >
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 transition-transform",
                  collapsedSections.hostedAgents ? "" : "rotate-90",
                )}
              />
              <span className="min-w-0 flex-1 truncate">Hosted agents</span>
              <span className="text-[0.6875rem] font-normal tabular-nums text-black/35 dark:text-white/30">
                {agents.length}
              </span>
            </button>
            {!collapsedSections.hostedAgents && agents.length ? (
              <div
                className="space-y-3"
                data-testid="hosted-agents-content"
                id="hosted-agents-content"
              >
                {privateAgents.length ? (
                  <AgentGroup
                    activeChannelId={activeChannelId}
                    activeChannelMemberPubkeys={
                      channels.find((channel) => channel.id === activeChannelId)
                        ?.memberPubkeys ?? []
                    }
                    agents={privateAgents}
                    collapsed={collapsedSections.privateAgents}
                    id="privateAgents"
                    label="Private to you"
                    onAddAgent={onAddAgent}
                    onToggle={() => toggleSection("privateAgents")}
                  />
                ) : null}
                {sharedAgents.length ? (
                  <AgentGroup
                    activeChannelId={activeChannelId}
                    activeChannelMemberPubkeys={
                      channels.find((channel) => channel.id === activeChannelId)
                        ?.memberPubkeys ?? []
                    }
                    agents={sharedAgents}
                    collapsed={collapsedSections.sharedAgents}
                    id="sharedAgents"
                    label="For everyone"
                    onAddAgent={onAddAgent}
                    onToggle={() => toggleSection("sharedAgents")}
                  />
                ) : null}
              </div>
            ) : !collapsedSections.hostedAgents && !agents.length ? (
              <p className="px-2 text-xs leading-5 text-black/40 dark:text-white/35">
                Agents appear here after the hosted runner connects.
              </p>
            ) : null}
          </section>
        </nav>

        <footer className="border-t border-sidebar-border p-3">
          <button
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
            type="button"
            onClick={onOpenGuide}
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <BookOpen className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Buzz Guide</p>
              <p className="text-xs text-muted-foreground">
                Agents, briefs, and safety rules
              </p>
            </div>
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-sidebar-accent"
            type="button"
            onClick={onOpenSettings}
          >
            <ProfileAvatar profile={profile} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {identity.displayName}
              </p>
              <p className="truncate text-[0.6875rem] text-muted-foreground">
                {truncatePubkey(identity.pubkey)}
              </p>
            </div>
            <Settings className="size-4 text-muted-foreground" />
          </button>
        </footer>
      </aside>
    </>
  );
}

function AgentGroup({
  id,
  label,
  agents,
  collapsed,
  activeChannelId,
  activeChannelMemberPubkeys,
  onToggle,
  onAddAgent,
}: {
  id: Exclude<AgentSectionId, "hostedAgents">;
  label: string;
  agents: WorkspaceProfile[];
  collapsed: boolean;
  activeChannelId: string | null;
  activeChannelMemberPubkeys: string[];
  onToggle: () => void;
  onAddAgent: (agent: WorkspaceProfile) => void;
}) {
  const contentId = `agent-section-${id}`;
  return (
    <section>
      <button
        aria-controls={contentId}
        aria-expanded={!collapsed}
        className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-black/35 hover:bg-black/4 hover:text-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500] dark:text-white/30 dark:hover:bg-white/5 dark:hover:text-white/55"
        data-testid={`agent-group-${id}-toggle`}
        type="button"
        onClick={onToggle}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            collapsed ? "" : "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-normal tabular-nums">{agents.length}</span>
      </button>
      {!collapsed ? (
        <div
          className="space-y-1"
          data-testid={`agent-group-${id}-content`}
          id={contentId}
        >
          {agents.map((agent) => (
            <div
              className="flex items-center gap-2 rounded-lg px-2 py-1.5"
              key={agent.pubkey}
            >
              <ProfileAvatar profile={agent} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{agent.name}</p>
                <p className="text-[0.6875rem] text-emerald-700 dark:text-emerald-400">
                  {agent.accessTier === "personal"
                    ? "Personal assistant"
                    : agent.accessTier === "admin"
                      ? "Admin only"
                      : "Available to everyone"}
                </p>
              </div>
              {activeChannelId && agent.accessTier !== "personal" ? (
                activeChannelMemberPubkeys.includes(agent.pubkey) ? (
                  <span
                    aria-label={`${agent.name} is already in the current channel`}
                    className="rounded-md p-1.5 text-emerald-700 dark:text-emerald-400"
                    role="img"
                    title="Already in current channel"
                  >
                    <Check className="size-3.5" />
                  </span>
                ) : (
                  <button
                    aria-label={`Add ${agent.name} to the current channel`}
                    className="rounded-md p-1.5 text-black/35 hover:bg-black/6 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/7 dark:hover:text-white/70"
                    title="Add to current channel"
                    type="button"
                    onClick={() => onAddAgent(agent)}
                  >
                    <Plus className="size-3.5" />
                  </button>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChannelSection({
  id,
  label,
  channels,
  collapsed,
  activeChannelId,
  onToggle,
  onSelectChannel,
  unreadChannelIds,
  starredChannelIds,
  onToggleStar,
}: {
  id: ChannelSectionId;
  label: string;
  channels: WorkspaceChannel[];
  collapsed: boolean;
  activeChannelId: string | null;
  onToggle: () => void;
  onSelectChannel: (channelId: string) => void;
  unreadChannelIds: ReadonlySet<string>;
  starredChannelIds: ReadonlySet<string>;
  onToggleStar: (channelId: string) => void;
}) {
  const contentId = `channel-section-${id}`;
  return (
    <section>
      <button
        aria-controls={contentId}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-black/40 hover:bg-black/4 hover:text-black/60 dark:text-white/35 dark:hover:bg-white/5 dark:hover:text-white/55"
        type="button"
        onClick={onToggle}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            collapsed ? "" : "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-normal tabular-nums">{channels.length}</span>
      </button>
      {!collapsed ? (
        <div className="mt-0.5 space-y-0.5" id={contentId}>
          {channels.map((channel) => (
            <ChannelButton
              active={activeChannelId === channel.id}
              channel={channel}
              key={channel.id}
              unread={unreadChannelIds.has(channel.id)}
              starred={starredChannelIds.has(channel.id)}
              onToggleStar={() => onToggleStar(channel.id)}
              onSelect={() => onSelectChannel(channel.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChannelButton({
  channel,
  active,
  onSelect,
  unread = false,
  starred = false,
  onToggleStar,
}: {
  channel: WorkspaceChannel;
  active: boolean;
  onSelect: () => void;
  unread?: boolean;
  starred?: boolean;
  onToggleStar: () => void;
}) {
  return (
    <div
      className={cn(
        "group/channel flex w-full items-center rounded-lg text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent",
      )}
    >
      <button
        aria-label={`${channel.name}${unread ? ", unread messages" : ""}`}
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
        type="button"
        onClick={onSelect}
      >
        {channel.type === "dm" ? (
          <MessageCircle className="size-3.5 shrink-0" />
        ) : channel.visibility === "private" ? (
          <Lock className="size-3.5 shrink-0" />
        ) : (
          <Hash className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{channel.name}</span>
        {unread ? (
          <span
            aria-hidden="true"
            className="ml-auto size-2 shrink-0 rounded-full bg-orange-500"
          />
        ) : null}
      </button>
      {channel.type !== "dm" ? (
        <button
          aria-label={`${starred ? "Remove" : "Add"} ${channel.name} ${starred ? "from" : "to"} favorites`}
          className={cn(
            "mr-1 rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a5a500]",
            starred
              ? "text-[#8b8c00] dark:text-[#e4e55e]"
              : "text-black/25 opacity-0 hover:text-black/60 group-hover/channel:opacity-100 focus-visible:opacity-100 dark:text-white/20 dark:hover:text-white/60",
          )}
          type="button"
          onClick={onToggleStar}
        >
          <Star className={cn("size-3.5", starred && "fill-current")} />
        </button>
      ) : null}
    </div>
  );
}

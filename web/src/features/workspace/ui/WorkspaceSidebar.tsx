import {
  Bot,
  BookOpen,
  ChevronRight,
  Hash,
  Lock,
  MessageCircle,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import type {
  WorkspaceChannel,
  WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import type { BrowserIdentity } from "@/shared/lib/browser-identity";

const PROJECT_CHANNEL_NAMES = new Set([
  "aaral-pms",
  "ashrayu-media",
  "atelier-crm",
  "bidwave",
  "factoryos",
  "fzine",
  "hrr-capital",
  "nuve",
  "project-dukaan",
  "renderboard",
  "sylars-control",
  "ummidvar",
  "vakeelos",
  "varvik-suite",
  "varvik-website",
  "zup-coffee",
]);

const SECTION_STORAGE_PREFIX = "buzz-web:channel-sections:v1";

type ChannelSectionId = "workspace" | "projects";
type CollapsedSections = Record<ChannelSectionId, boolean>;

function sectionStorageKey(pubkey: string): string {
  return `${SECTION_STORAGE_PREFIX}:${pubkey}`;
}

function readCollapsedSections(pubkey: string): CollapsedSections {
  const fallback = { workspace: false, projects: false };
  try {
    const stored = window.localStorage.getItem(sectionStorageKey(pubkey));
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<CollapsedSections>;
    return {
      workspace: parsed.workspace === true,
      projects: parsed.projects === true,
    };
  } catch {
    return fallback;
  }
}

export function isProjectChannel(channel: WorkspaceChannel): boolean {
  return (
    PROJECT_CHANNEL_NAMES.has(channel.name.toLowerCase()) ||
    channel.name.toLowerCase().startsWith("project-")
  );
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
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#d7d72e]/18 font-semibold text-[#969600]",
        size === "sm" ? "size-7 text-[0.6875rem]" : "size-9 text-xs",
      )}
    >
      {profile.picture ? (
        <img alt="" className="size-full object-cover" src={profile.picture} />
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

export function WorkspaceSidebar({
  identity,
  channels,
  agents,
  activeChannelId,
  open,
  onClose,
  onSelectChannel,
  onCreateChannel,
  onOpenSettings,
  onOpenGuide,
  onAddAgent,
}: {
  identity: BrowserIdentity;
  channels: WorkspaceChannel[];
  agents: WorkspaceProfile[];
  activeChannelId: string | null;
  open: boolean;
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onAddAgent: (agent: WorkspaceProfile) => void;
}) {
  const streams = channels.filter((channel) => channel.type !== "dm");
  const directMessages = channels.filter((channel) => channel.type === "dm");
  const workspaceChannels = streams.filter(
    (channel) => !isProjectChannel(channel),
  );
  const projectChannels = streams.filter(isProjectChannel);
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
    const section: ChannelSectionId = isProjectChannel(activeChannel)
      ? "projects"
      : "workspace";
    setCollapsedSections((current) =>
      current[section] ? { ...current, [section]: false } : current,
    );
  }, [activeChannelId, channels]);

  const toggleSection = (section: ChannelSectionId) => {
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
          "fixed inset-y-0 left-0 z-40 flex h-dvh min-h-0 w-[17rem] flex-col border-r border-black/10 bg-[#eef0e8] text-[#272a23] transition-transform md:static md:h-full md:translate-x-0 dark:border-white/8 dark:bg-[#171916] dark:text-[#e8eadd]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <header className="flex h-16 items-center justify-between border-b border-black/8 px-4 dark:border-white/8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#d7d72e] font-black text-[#171912]">
              V
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">VarVik Studios</p>
              <p className="truncate text-xs text-black/45 dark:text-white/40">
                {identity.displayName}
              </p>
            </div>
          </div>
          <button
            aria-label="Close navigation"
            className="rounded-lg p-2 hover:bg-black/5 md:hidden dark:hover:bg-white/5"
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
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-xs font-semibold text-black/45 dark:text-white/40">
                Channels
              </p>
              <button
                aria-label="Create channel"
                className="rounded-md p-1 hover:bg-black/6 dark:hover:bg-white/7"
                type="button"
                onClick={onCreateChannel}
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              <ChannelSection
                activeChannelId={activeChannelId}
                channels={workspaceChannels}
                collapsed={collapsedSections.workspace}
                id="workspace"
                label="Workspace"
                onSelectChannel={selectChannel}
                onToggle={() => toggleSection("workspace")}
              />
              {projectChannels.length ? (
                <ChannelSection
                  activeChannelId={activeChannelId}
                  channels={projectChannels}
                  collapsed={collapsedSections.projects}
                  id="projects"
                  label="Projects"
                  onSelectChannel={selectChannel}
                  onToggle={() => toggleSection("projects")}
                />
              ) : null}
            </div>
          </div>

          {directMessages.length ? (
            <div className="mb-6">
              <p className="mb-2 px-2 text-xs font-semibold text-black/45 dark:text-white/40">
                Direct messages
              </p>
              <div className="space-y-0.5">
                {directMessages.map((channel) => (
                  <ChannelButton
                    active={activeChannelId === channel.id}
                    channel={channel}
                    key={channel.id}
                    onSelect={() => {
                      onSelectChannel(channel.id);
                      onClose();
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-xs font-semibold text-black/45 dark:text-white/40">
                Hosted agents
              </p>
              <span className="text-[0.6875rem] text-black/35 dark:text-white/30">
                {agents.length}
              </span>
            </div>
            {agents.length ? (
              <div className="space-y-3">
                {privateAgents.length ? (
                  <AgentGroup
                    activeChannelId={activeChannelId}
                    agents={privateAgents}
                    label="Private to you"
                    onAddAgent={onAddAgent}
                  />
                ) : null}
                {sharedAgents.length ? (
                  <AgentGroup
                    activeChannelId={activeChannelId}
                    agents={sharedAgents}
                    label={privateAgents.length ? "For everyone" : undefined}
                    onAddAgent={onAddAgent}
                  />
                ) : null}
              </div>
            ) : (
              <p className="px-2 text-xs leading-5 text-black/40 dark:text-white/35">
                Agents appear here after the hosted runner connects.
              </p>
            )}
          </div>
        </nav>

        <footer className="border-t border-black/8 p-3 dark:border-white/8">
          <button
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-black/60 hover:bg-black/5 dark:text-white/55 dark:hover:bg-white/5"
            type="button"
            onClick={onOpenGuide}
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#d7d72e]/20 text-[#7d7e00]">
              <BookOpen className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Buzz Guide</p>
              <p className="text-xs text-black/40 dark:text-white/35">
                Agents, briefs, and safety rules
              </p>
            </div>
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
            type="button"
            onClick={onOpenSettings}
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-black/7 text-xs font-semibold dark:bg-white/8">
              {profileInitials(identity.displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {identity.displayName}
              </p>
              <p className="truncate text-[0.6875rem] text-black/40 dark:text-white/35">
                {truncatePubkey(identity.pubkey)}
              </p>
            </div>
            <Settings className="size-4 text-black/35 dark:text-white/30" />
          </button>
        </footer>
      </aside>
    </>
  );
}

function AgentGroup({
  label,
  agents,
  activeChannelId,
  onAddAgent,
}: {
  label?: string;
  agents: WorkspaceProfile[];
  activeChannelId: string | null;
  onAddAgent: (agent: WorkspaceProfile) => void;
}) {
  return (
    <div>
      {label ? (
        <p className="mb-1 px-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-black/35 dark:text-white/30">
          {label}
        </p>
      ) : null}
      <div className="space-y-1">
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
              <button
                aria-label={`Add ${agent.name} to the current channel`}
                className="rounded-md p-1.5 text-black/35 hover:bg-black/6 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/7 dark:hover:text-white/70"
                title="Add to current channel"
                type="button"
                onClick={() => onAddAgent(agent)}
              >
                <Plus className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
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
}: {
  id: ChannelSectionId;
  label: string;
  channels: WorkspaceChannel[];
  collapsed: boolean;
  activeChannelId: string | null;
  onToggle: () => void;
  onSelectChannel: (channelId: string) => void;
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
}: {
  channel: WorkspaceChannel;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        active
          ? "bg-[#d7d72e]/35 font-medium text-[#363600] dark:text-[#f1f29e]"
          : "text-black/65 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5",
      )}
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
    </button>
  );
}

import {
  Bot,
  Hash,
  Lock,
  MessageCircle,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import type {
  WorkspaceChannel,
  WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import type { BrowserIdentity } from "@/shared/lib/browser-identity";

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
  onAddAgent: (agent: WorkspaceProfile) => void;
}) {
  const streams = channels.filter((channel) => channel.type !== "dm");
  const directMessages = channels.filter((channel) => channel.type === "dm");
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
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[17rem] flex-col border-r border-black/10 bg-[#eef0e8] text-[#272a23] transition-transform md:static md:translate-x-0 dark:border-white/8 dark:bg-[#171916] dark:text-[#e8eadd]",
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

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
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
            <div className="space-y-0.5">
              {streams.map((channel) => (
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
                        Available
                      </p>
                    </div>
                    {activeChannelId ? (
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
            ) : (
              <p className="px-2 text-xs leading-5 text-black/40 dark:text-white/35">
                Agents appear here after the hosted runner connects.
              </p>
            )}
          </div>
        </nav>

        <footer className="border-t border-black/8 p-3 dark:border-white/8">
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

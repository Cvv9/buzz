import { Bell, CheckCheck, Inbox } from "lucide-react";
import type {
  WorkspaceInboxCategory,
  WorkspaceInboxItem,
} from "../workspace-read-state";
import type { WorkspaceChannel, WorkspaceProfile } from "../workspace-api";

const categoryLabels: Record<WorkspaceInboxCategory, string> = {
  agent_activity: "Agent update",
  direct_message: "Direct message",
  mention: "Mention",
  needs_action: "Needs action",
  reply: "Reply",
};

function preview(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function WorkspaceInbox({
  channels,
  items,
  onMarkAllRead,
  onMarkItemRead,
  onSelectItem,
  profileFor,
}: {
  channels: readonly WorkspaceChannel[];
  items: readonly WorkspaceInboxItem[];
  onMarkAllRead: () => void;
  onMarkItemRead: (item: WorkspaceInboxItem) => void;
  onSelectItem: (item: WorkspaceInboxItem) => void;
  profileFor: (pubkey: string) => WorkspaceProfile;
}) {
  const channelNames = new Map(
    channels.map((channel) => [channel.id, channel.name]),
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="workspace-inbox"
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-black/8 px-4 dark:border-white/8 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Inbox className="size-4 shrink-0 text-black/40 dark:text-white/35" />
          <div>
            <h1 className="text-sm font-semibold">Inbox</h1>
            <p className="text-xs text-black/40 dark:text-white/35">
              Mentions, replies, action items, and your agents’ updates.
            </p>
          </div>
        </div>
        {items.length ? (
          <button
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-black/55 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/5"
            type="button"
            onClick={onMarkAllRead}
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {items.length ? (
          <div className="mx-auto max-w-3xl divide-y divide-black/8 overflow-hidden rounded-2xl border border-black/8 dark:divide-white/8 dark:border-white/8">
            {items.map((item) => {
              const profile = profileFor(item.pubkey);
              const channelExists =
                item.channelId !== null && channelNames.has(item.channelId);
              return (
                <button
                  className="flex w-full gap-3 px-4 py-3 text-left hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d36b27] dark:hover:bg-white/[0.04]"
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (channelExists) onSelectItem(item);
                    else onMarkItemRead(item);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-orange-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {profile.name}
                      </span>
                      <span className="rounded-full bg-orange-500/12 px-2 py-0.5 text-[0.6875rem] font-medium text-orange-700 dark:text-orange-300">
                        {categoryLabels[item.category]}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-black/40 dark:text-white/35">
                        {relativeTime(item.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-black/58 dark:text-white/55">
                      {preview(item.content) || "No message content"}
                    </span>
                    <span className="mt-1 block text-xs text-black/40 dark:text-white/35">
                      {channelExists
                        ? `#${channelNames.get(item.channelId ?? "")}`
                        : "Personal notification"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-72 items-center justify-center px-6 text-center">
            <div className="max-w-sm">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#d7d72e]/25 text-[#7d7e00]">
                <Bell className="size-5" />
              </div>
              <h2 className="mt-4 font-semibold">You’re all caught up</h2>
              <p className="mt-2 text-sm leading-6 text-black/45 dark:text-white/40">
                New mentions, replies, action items, and personal-agent updates
                will appear here.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

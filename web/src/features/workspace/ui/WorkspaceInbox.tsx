import { Bell, CheckCheck, Inbox, X } from "lucide-react";
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
  mode = "inbox",
  onDismissAll,
  onDismissItem,
  onMarkItemRead,
  onSelectItem,
  profileFor,
}: {
  channels: readonly WorkspaceChannel[];
  items: readonly WorkspaceInboxItem[];
  mode?: "alerts" | "inbox";
  onDismissAll: () => void;
  onDismissItem: (item: WorkspaceInboxItem) => void;
  onMarkItemRead: (item: WorkspaceInboxItem) => void;
  onSelectItem: (item: WorkspaceInboxItem) => void;
  profileFor: (pubkey: string) => WorkspaceProfile;
}) {
  const isAlerts = mode === "alerts";
  const unreadCount = items.filter((item) => !item.isRead).length;
  const channelNames = new Map(
    channels.map((channel) => [channel.id, channel.name]),
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid={isAlerts ? "workspace-alerts" : "workspace-inbox"}
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {isAlerts ? (
            <Bell className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Inbox className="size-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <h1 className="text-sm font-semibold">
              {isAlerts ? "Alerts" : "Inbox"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isAlerts
                ? "Mentions and replies across every channel."
                : "Only requests that explicitly need your approval."}
            </p>
          </div>
        </div>
        {unreadCount ? (
          <button
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
            type="button"
            onClick={onDismissAll}
          >
            <CheckCheck className="size-3.5" />
            {isAlerts ? "Mark all read" : "Clear inbox"}
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {items.length ? (
          <div className="mx-auto max-w-3xl divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {items.map((item) => {
              const profile = profileFor(item.pubkey);
              const channelExists =
                item.channelId !== null && channelNames.has(item.channelId);
              return (
                <div className="group relative flex" key={item.id}>
                  <button
                    className={`flex min-w-0 flex-1 gap-3 px-4 py-3 pr-12 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${item.isRead ? "bg-muted/40" : ""}`}
                    type="button"
                    onClick={() => {
                      if (channelExists) onSelectItem(item);
                      else onMarkItemRead(item);
                    }}
                  >
                    {item.isRead ? (
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-2 shrink-0"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-orange-500"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {profile.name}
                        </span>
                        <span className="rounded-full bg-orange-500/12 px-2 py-0.5 text-[0.6875rem] font-medium text-orange-700 dark:text-orange-300">
                          {categoryLabels[item.category]}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {relativeTime(item.createdAt)}
                        </span>
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                        {preview(item.content) || "No message content"}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {channelExists
                          ? `#${channelNames.get(item.channelId ?? "")}`
                          : "Personal notification"}
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={
                      isAlerts ? "Dismiss alert" : "Dismiss from inbox"
                    }
                    className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-100 transition hover:bg-accent hover:text-foreground sm:opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                    data-testid={`workspace-inbox-dismiss-${item.id}`}
                    onClick={() => onDismissItem(item)}
                    type="button"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-72 items-center justify-center px-6 text-center">
            <div className="max-w-sm">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#d7d72e]/25 text-[#7d7e00]">
                <Bell className="size-5" />
              </div>
              <h2 className="mt-4 font-semibold">
                {isAlerts ? "No alerts yet" : "Your inbox is clear"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {isAlerts
                  ? "Mentions and replies will appear here without getting lost in channel traffic."
                  : "Requests appear only when they explicitly require your approval."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

import { readBrowserPreferences } from "@/features/preferences/browser-preferences";
import type { WorkspaceChannel, WorkspaceMessage } from "./workspace-api";

/** Show a browser notification for a message that arrived while the tab is hidden. */
export function maybeNotifyChannelMessage({
  channel,
  event,
  viewerPubkey,
}: {
  channel: WorkspaceChannel | undefined;
  event: WorkspaceMessage;
  viewerPubkey: string;
}) {
  if (!channel || !document.hidden) return;
  const preferences = readBrowserPreferences(viewerPubkey);
  if (
    !preferences.notifications ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  const title =
    channel.type === "dm"
      ? `New message from ${channel.name}`
      : `New message in #${channel.name}`;
  new Notification(title, {
    body:
      event.content.length > 180
        ? `${event.content.slice(0, 177)}…`
        : event.content,
    tag: `buzz-channel-${event.channelId}`,
    silent: !preferences.notificationSound,
  });
}

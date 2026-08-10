import { queryEvents } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  MESSAGE_KINDS,
  parseWorkspaceMessage,
  type WorkspaceMessage,
} from "./workspace-api";

/** Fetch an exact thread root and its bounded descendants for a deep link. */
export async function listChannelThreadMessages(
  channelId: string,
  rootEventId: string,
): Promise<WorkspaceMessage[]> {
  if (!channelId || !/^[0-9a-f]{64}$/i.test(rootEventId)) return [];
  const events = await queryEvents(relayWsUrl(), {
    kinds: MESSAGE_KINDS,
    "#h": [channelId],
    ids: [rootEventId],
    limit: 1,
  });
  const replies = await queryEvents(relayWsUrl(), {
    kinds: MESSAGE_KINDS,
    "#h": [channelId],
    "#e": [rootEventId],
    limit: 500,
  });
  return [...events, ...replies]
    .map(parseWorkspaceMessage)
    .filter((message) => message.channelId === channelId)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

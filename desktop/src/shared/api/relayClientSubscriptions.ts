import {
  KIND_CHANNEL_THREAD_SUMMARY,
  CHANNEL_EVENT_KINDS,
  KIND_TYPING_INDICATOR,
  KIND_USER_STATUS,
} from "@/shared/constants/kinds";
import {
  buildChannelFilter,
  buildGlobalStreamFilter,
} from "@/shared/api/relayChannelFilters";
import { signRelayEvent } from "@/shared/api/tauri";
import type {
  LiveSubscriptionReadiness,
  RelaySubscriptionFilter,
} from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";

type UserStatusInput = { text: string; emoji: string; expiresAt?: number };

type Subscribe = (
  filter: RelaySubscriptionFilter,
  onEvent: (event: RelayEvent) => void,
  onReady?: (readiness: LiveSubscriptionReadiness) => void,
  readinessTimeoutMs?: number,
  signal?: AbortSignal,
  priority?: "interactive",
) => Promise<() => Promise<void>>;

type PublishEvent = (
  event: RelayEvent,
  timeoutMessage: string,
  sendErrorMessage: string,
  isCurrent?: () => boolean,
) => Promise<RelayEvent>;

/** RelayClient's typed channel/status subscription facade over its session. */
export function createRelayClientSubscriptions(
  subscribe: Subscribe,
  ensureConnected: () => Promise<number>,
  publishEvent: PublishEvent,
) {
  return {
    subscribeToChannel(
      channelId: string,
      onEvent: (event: RelayEvent) => void,
    ) {
      return subscribe(buildChannelFilter(channelId, 50), onEvent);
    },

    /** Subscribe to channel rows and aux starting now, without history replay. */
    subscribeToChannelLive(
      channelId: string,
      onEvent: (event: RelayEvent) => void,
    ) {
      return subscribe(
        {
          // 39005 belongs only to this window-store subscription.
          kinds: [...CHANNEL_EVENT_KINDS, KIND_CHANNEL_THREAD_SUMMARY],
          "#h": [channelId],
          limit: 1000,
          since: Math.floor(Date.now() / 1_000),
        },
        onEvent,
      );
    },

    /** Subscribe to huddle lifecycle events without channel-message noise. */
    subscribeToHuddleEvents(
      channelId: string,
      onEvent: (event: RelayEvent) => void,
    ) {
      return subscribe(
        { kinds: [48100, 48101, 48102, 48103], "#h": [channelId], limit: 100 },
        onEvent,
      );
    },

    subscribeToTypingIndicators(
      channelId: string,
      onEvent: (event: RelayEvent) => void,
    ) {
      return subscribe(
        {
          kinds: [KIND_TYPING_INDICATOR],
          "#h": [channelId],
          limit: 10,
          since: Math.floor(Date.now() / 1_000) - 10,
        },
        onEvent,
      );
    },

    async publishUserStatus(status: UserStatusInput): Promise<RelayEvent> {
      await ensureConnected();
      const tags: string[][] = [["d", "general"]];
      if (status.emoji) tags.push(["emoji", status.emoji]);
      if (status.expiresAt) tags.push(["expiration", String(status.expiresAt)]);
      const event = await signRelayEvent({
        kind: KIND_USER_STATUS,
        content: status.text,
        tags,
      });
      return publishEvent(
        event,
        "Timed out publishing user status",
        "Failed to publish user status",
      );
    },

    /** Subscribe to kind:30315 user status events (live only, no backfill). */
    subscribeToUserStatusUpdates(onEvent: (event: RelayEvent) => void) {
      return subscribe(
        { kinds: [KIND_USER_STATUS], "#d": ["general"], limit: 0 },
        onEvent,
      );
    },

    subscribeToAllStreamMessages(onEvent: (event: RelayEvent) => void) {
      return subscribe(buildGlobalStreamFilter(50), onEvent);
    },

    subscribeLive(
      filter: RelaySubscriptionFilter,
      onEvent: (event: RelayEvent) => void,
      onReady?: (readiness: LiveSubscriptionReadiness) => void,
      readinessTimeoutMs?: number,
      signal?: AbortSignal,
    ) {
      return subscribe(filter, onEvent, onReady, readinessTimeoutMs, signal);
    },

    /** Prioritize an interactive consumer without changing its filter or pacing. */
    subscribeInteractive(
      filter: RelaySubscriptionFilter,
      onEvent: (event: RelayEvent) => void,
    ) {
      return subscribe(
        filter,
        onEvent,
        undefined,
        undefined,
        undefined,
        "interactive",
      );
    },
  };
}

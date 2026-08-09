import {
  type NostrEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  projectPulseEvents,
  PULSE_READABLE_KINDS,
  type PulseEvent,
} from "./pulse-policy";

const PULSE_PAGE_SIZE = 50;

export type PulseFeedPage = {
  events: PulseEvent[];
  nextBefore: number | null;
};

/** Query a bounded page across already-readable channel ids, never telemetry. */
export async function listPulsePage(
  channelIds: string[],
  before?: number,
): Promise<PulseFeedPage> {
  const readableChannelIds = [...new Set(channelIds.filter(Boolean))].slice(
    0,
    500,
  );
  if (!readableChannelIds.length) return { events: [], nextBefore: null };
  const events = await queryEvents(relayWsUrl(), {
    kinds: [...PULSE_READABLE_KINDS],
    "#h": readableChannelIds,
    until: before,
    limit: PULSE_PAGE_SIZE + 1,
  });
  const projected = projectPulseEvents(events, readableChannelIds);
  return {
    events: projected.slice(0, PULSE_PAGE_SIZE),
    nextBefore:
      projected.length > PULSE_PAGE_SIZE
        ? (projected[PULSE_PAGE_SIZE - 1]?.created_at ?? null)
        : null,
  };
}

export function subscribeToPulse(
  channelIds: string[],
  onEvent: (event: NostrEvent) => void,
) {
  const readableChannelIds = [...new Set(channelIds.filter(Boolean))].slice(
    0,
    500,
  );
  if (!readableChannelIds.length) return () => undefined;
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [...PULSE_READABLE_KINDS],
      "#h": readableChannelIds,
      since: Math.floor(Date.now() / 1_000),
    },
    onEvent,
  );
}

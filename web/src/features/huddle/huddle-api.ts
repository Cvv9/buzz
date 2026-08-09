import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  foldHuddleLifecycle,
  isHuddleChannelId,
  KIND_HUDDLE_GUIDELINES,
  KIND_HUDDLE_STARTED,
  parseHuddleLifecycleEvent,
  HUDDLE_LIFECYCLE_KINDS,
  newestHuddleGuideline,
  type HuddleSession,
} from "./huddle-policy";

const HUDDLE_TTL_SECONDS = 60 * 60;

function requireChannelId(channelId: string) {
  if (!isHuddleChannelId(channelId)) {
    throw new Error("Huddles require a canonical channel id.");
  }
}

export async function listChannelHuddles(
  parentChannelId: string,
): Promise<HuddleSession[]> {
  const events = await queryEvents(relayWsUrl(), {
    kinds: [...HUDDLE_LIFECYCLE_KINDS],
    "#h": [parentChannelId],
    limit: 500,
  });
  return foldHuddleLifecycle(events, parentChannelId);
}

export function subscribeToChannelHuddles(
  parentChannelId: string,
  onEvent: (event: NostrEvent) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
) {
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [...HUDDLE_LIFECYCLE_KINDS],
      "#h": [parentChannelId],
      since: Math.floor(Date.now() / 1_000),
    },
    (event) => {
      if (parseHuddleLifecycleEvent(event, parentChannelId)) onEvent(event);
    },
    onStatus,
  );
}

export async function listHuddleGuideline(ephemeralChannelId: string) {
  requireChannelId(ephemeralChannelId);
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_HUDDLE_GUIDELINES],
    "#h": [ephemeralChannelId],
    limit: 50,
  });
  return newestHuddleGuideline(events, ephemeralChannelId);
}

export function subscribeToHuddleGuideline(
  ephemeralChannelId: string,
  onEvent: (event: NostrEvent) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
) {
  requireChannelId(ephemeralChannelId);
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_HUDDLE_GUIDELINES],
      "#h": [ephemeralChannelId],
      since: Math.floor(Date.now() / 1_000),
    },
    (event) => {
      if (newestHuddleGuideline([event], ephemeralChannelId)) onEvent(event);
    },
    onStatus,
  );
}

export function publishHuddleGuideline(
  ephemeralChannelId: string,
  content: string,
) {
  requireChannelId(ephemeralChannelId);
  const normalized = content.trim();
  if (!normalized) throw new Error("Guidelines cannot be empty.");
  return publishEvent(relayWsUrl(), {
    kind: KIND_HUDDLE_GUIDELINES,
    content: normalized,
    tags: [["h", ephemeralChannelId]],
  });
}

export type CreatedHuddle = {
  ephemeralChannelId: string;
  startedEvent: NostrEvent;
};

/**
 * Create the same short-lived private channel used by desktop, then publish
 * the parent-channel lifecycle advisory. Joining its audio socket remains a
 * separate, explicit action.
 */
export async function startBrowserHuddle(
  parentChannelId: string,
  guideline = "Use voice mode for this huddle. Keep the discussion focused and respectful.",
): Promise<CreatedHuddle> {
  requireChannelId(parentChannelId);
  const ephemeralChannelId = crypto.randomUUID();
  const channelName = `huddle-${ephemeralChannelId.slice(0, 8)}`;
  await publishEvent(relayWsUrl(), {
    kind: 9007,
    content: "",
    tags: [
      ["h", ephemeralChannelId],
      ["name", channelName],
      ["visibility", "private"],
      ["channel_type", "stream"],
      ["ttl", String(HUDDLE_TTL_SECONDS)],
    ],
  });
  try {
    await publishHuddleGuideline(ephemeralChannelId, guideline);
  } catch {
    // Guidelines are intentionally best-effort, matching desktop startup.
  }
  try {
    const startedEvent = await publishEvent(relayWsUrl(), {
      kind: KIND_HUDDLE_STARTED,
      content: JSON.stringify({ ephemeral_channel_id: ephemeralChannelId }),
      tags: [["h", parentChannelId]],
    });
    return { ephemeralChannelId, startedEvent };
  } catch (error) {
    // Do not leave a joinable orphan if the parent lifecycle event was refused.
    void publishEvent(relayWsUrl(), {
      kind: 9002,
      content: "",
      tags: [
        ["h", ephemeralChannelId],
        ["archived", "true"],
      ],
    }).catch(() => undefined);
    throw error;
  }
}

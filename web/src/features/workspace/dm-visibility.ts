import * as React from "react";
import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  isWorkspaceChannelId,
  parseDmVisibilitySnapshot,
} from "./dm-visibility-policy";

export { parseDmVisibilitySnapshot } from "./dm-visibility-policy";

export const KIND_DM_OPEN = 41010;
export const KIND_DM_ADD_MEMBER = 41011;
export const KIND_DM_HIDE = 41012;
export const KIND_DM_VISIBILITY = 30622;

function normalizedPubkey(pubkey: string) {
  return pubkey.trim().toLowerCase();
}

function isPubkey(value: string) {
  return /^[0-9a-f]{64}$/i.test(value);
}

function newer(left: NostrEvent, right: NostrEvent) {
  return (
    left.created_at > right.created_at ||
    (left.created_at === right.created_at && left.id < right.id)
  );
}

export async function fetchHiddenDmChannelIds(
  viewerPubkey: string,
): Promise<Set<string>> {
  const viewer = normalizedPubkey(viewerPubkey);
  if (!isPubkey(viewer)) return new Set<string>();
  const snapshots = await queryEvents(relayWsUrl(), {
    kinds: [KIND_DM_VISIBILITY],
    "#p": [viewer],
    limit: 20,
  });
  const latest = snapshots.reduce<NostrEvent | null>(
    (current, event) => (!current || newer(event, current) ? event : current),
    null,
  );
  return latest
    ? (parseDmVisibilitySnapshot(latest, viewer) ?? new Set<string>())
    : new Set<string>();
}

/** Current account-only DM visibility snapshot with realtime replacement. */
export function useDmVisibility(viewerPubkey?: string) {
  const viewer = normalizedPubkey(viewerPubkey ?? "");
  const [hiddenChannelIds, setHiddenChannelIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  React.useEffect(() => {
    setHiddenChannelIds(new Set());
    if (!isPubkey(viewer)) return;
    let cancelled = false;
    let latest: NostrEvent | null = null;

    const accept = (event: NostrEvent) => {
      const parsed = parseDmVisibilitySnapshot(event, viewer);
      if (!parsed || (latest && !newer(event, latest))) return;
      latest = event;
      if (!cancelled) setHiddenChannelIds(parsed);
    };

    void fetchHiddenDmChannelIds(viewer)
      .then((snapshot) => {
        if (!cancelled && !latest) setHiddenChannelIds(snapshot);
      })
      .catch(() => {
        // Visibility is a presentation projection; relay recovery retries live.
      });
    const stop = subscribeEvents(
      relayWsUrl(),
      { kinds: [KIND_DM_VISIBILITY], "#p": [viewer] },
      accept,
      (status) => {
        if (status === "live") {
          void fetchHiddenDmChannelIds(viewer)
            .then((snapshot) => {
              if (!cancelled && !latest) setHiddenChannelIds(snapshot);
            })
            .catch(() => {});
        }
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [viewer]);

  return hiddenChannelIds;
}

function recipientTags(pubkeys: string[]) {
  const recipients = [...new Set(pubkeys.map(normalizedPubkey))].filter(
    isPubkey,
  );
  if (recipients.length === 0 || recipients.length > 8) {
    throw new Error("Choose between one and eight valid recipients.");
  }
  return recipients.map((pubkey) => ["p", pubkey]);
}

export function openDirectMessage(pubkeys: string[]) {
  return publishEvent(relayWsUrl(), {
    kind: KIND_DM_OPEN,
    content: "",
    tags: recipientTags(pubkeys),
  });
}

export function addDirectMessageMembers(channelId: string, pubkeys: string[]) {
  if (!isWorkspaceChannelId(channelId)) {
    throw new Error("This direct-message link is invalid.");
  }
  return publishEvent(relayWsUrl(), {
    kind: KIND_DM_ADD_MEMBER,
    content: "",
    tags: [["h", channelId], ...recipientTags(pubkeys)],
  });
}

export function hideDirectMessage(channelId: string) {
  if (!isWorkspaceChannelId(channelId)) {
    throw new Error("This direct-message link is invalid.");
  }
  return publishEvent(relayWsUrl(), {
    kind: KIND_DM_HIDE,
    content: "",
    tags: [["h", channelId]],
  });
}

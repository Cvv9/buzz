import * as React from "react";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";
import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  KIND_READ_STATE,
  type WorkspaceChannel,
  type WorkspaceMessage,
} from "./workspace-api";
import {
  APPROVAL_REQUEST_KIND,
  inboxDismissContextId,
  isTargetedApprovalRequest,
} from "./workspace-inbox-policy.mjs";

const READ_STATE_D_TAG_PREFIX = "read-state:";
const READ_STATE_HORIZON_SECONDS = 7 * 24 * 60 * 60;
const LOCAL_READ_STATE_PREFIX = "buzz.web.read-state.v1";
const SLOT_ID_PREFIX = "buzz.web.read-state.slot.v1";
const PUBLISH_DELAY_MS = 1_000;

const CONVERSATIONAL_KINDS = [9, 40002] as const;
// Mirrors the mobile/desktop personal feed sources. Channel messages keep
// their dot semantics, while these sources feed the Inbox only when addressed
// to the current identity.
const MENTION_KINDS = [9, 40002, 1, 45001, 45003] as const;
const AGENT_ACTIVITY_KINDS = [
  43001, 43002, 43003, 43004, 43005, 43006,
] as const;
const INBOX_SOURCE_KINDS = [
  ...MENTION_KINDS,
  APPROVAL_REQUEST_KIND,
  ...AGENT_ACTIVITY_KINDS,
] as const;

type ReadStateBlob = {
  v: 1;
  client_id: string;
  contexts: Record<string, number>;
};

export type WorkspaceInboxCategory =
  | "mention"
  | "reply"
  | "needs_action"
  | "agent_activity"
  | "direct_message";

export type WorkspaceInboxItem = {
  category: WorkspaceInboxCategory;
  channelId: string | null;
  content: string;
  contextId: string;
  dismissContextId: string;
  createdAt: number;
  id: string;
  isRead: boolean;
  pubkey: string;
};

type StoredReadState = {
  contexts: Record<string, number>;
  version: 1;
};

function storageKey(pubkey: string) {
  return `${LOCAL_READ_STATE_PREFIX}:${pubkey.toLowerCase()}`;
}

function slotKey(pubkey: string) {
  return `${SLOT_ID_PREFIX}:${pubkey.toLowerCase()}`;
}

function randomSlotId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function readSlotId(pubkey: string) {
  const key = slotKey(pubkey);
  const existing = localStorage.getItem(key);
  if (existing && existing.length <= 64) return existing;
  const slotId = randomSlotId();
  localStorage.setItem(key, slotId);
  return slotId;
}

export function readLocalWorkspaceReadState(
  pubkey: string,
): Map<string, number> {
  try {
    const raw = localStorage.getItem(storageKey(pubkey));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Partial<StoredReadState>;
    if (parsed.version !== 1 || !parsed.contexts) return new Map();
    return new Map(
      Object.entries(parsed.contexts).filter(
        ([context, timestamp]) =>
          context.length > 0 &&
          typeof timestamp === "number" &&
          Number.isInteger(timestamp) &&
          timestamp >= 0,
      ),
    );
  } catch {
    return new Map();
  }
}

function writeLocalWorkspaceReadState(
  pubkey: string,
  contexts: ReadonlyMap<string, number>,
) {
  const record: Record<string, number> = {};
  for (const [context, timestamp] of contexts) record[context] = timestamp;
  localStorage.setItem(
    storageKey(pubkey),
    JSON.stringify({ version: 1, contexts: record } satisfies StoredReadState),
  );
}

function firstTag(event: Pick<WorkspaceMessage, "tags">, name: string) {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function parseReadStateBlob(value: unknown): ReadStateBlob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ReadStateBlob>;
  if (
    candidate.v !== 1 ||
    typeof candidate.client_id !== "string" ||
    candidate.client_id.length === 0 ||
    !candidate.contexts ||
    typeof candidate.contexts !== "object" ||
    Array.isArray(candidate.contexts)
  ) {
    return null;
  }
  const contexts: Record<string, number> = {};
  for (const [context, timestamp] of Object.entries(candidate.contexts)) {
    if (
      context.length > 0 &&
      context.length <= 256 &&
      typeof timestamp === "number" &&
      Number.isInteger(timestamp) &&
      timestamp >= 0
    ) {
      contexts[context] = timestamp;
    }
  }
  return { v: 1, client_id: candidate.client_id, contexts };
}

async function readRemoteMarkers(pubkey: string): Promise<Map<string, number>> {
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_READ_STATE],
    authors: [pubkey],
    "#t": ["read-state"],
    since: Math.floor(Date.now() / 1000) - READ_STATE_HORIZON_SECONDS,
    limit: 500,
  });
  const markers = new Map<string, number>();
  for (const event of events) {
    if (event.pubkey.toLowerCase() !== pubkey.toLowerCase()) continue;
    const dTags = event.tags.filter((tag) => tag[0] === "d");
    const readStateTags = event.tags.filter(
      (tag) => tag[0] === "t" && tag[1] === "read-state",
    );
    if (
      dTags.length !== 1 ||
      !dTags[0]?.[1]?.startsWith(READ_STATE_D_TAG_PREFIX) ||
      readStateTags.length !== 1
    ) {
      continue;
    }
    try {
      const parsed = parseReadStateBlob(
        JSON.parse(await nip44DecryptFromSelf(pubkey, event.content)),
      );
      if (!parsed) continue;
      for (const [context, timestamp] of Object.entries(parsed.contexts)) {
        const current = markers.get(context) ?? 0;
        if (timestamp > current) markers.set(context, timestamp);
      }
    } catch {
      // Read state remains available locally when a NIP-07 signer does not
      // expose NIP-44 or an older event cannot be decrypted.
    }
  }
  return markers;
}

async function publishMarkers(
  pubkey: string,
  contexts: ReadonlyMap<string, number>,
) {
  const plaintext = JSON.stringify({
    v: 1,
    client_id: readSlotId(pubkey),
    contexts: Object.fromEntries(contexts),
  } satisfies ReadStateBlob);
  await publishEvent(relayWsUrl(), {
    kind: KIND_READ_STATE,
    content: await nip44EncryptToSelf(pubkey, plaintext),
    tags: [
      ["d", `${READ_STATE_D_TAG_PREFIX}${readSlotId(pubkey)}`],
      ["t", "read-state"],
    ],
  });
}

function mergeMarkers(...sources: ReadonlyMap<string, number>[]) {
  const result = new Map<string, number>();
  for (const source of sources) {
    for (const [context, timestamp] of source) {
      if (timestamp > (result.get(context) ?? 0))
        result.set(context, timestamp);
    }
  }
  return result;
}

function isExternalMessage(event: WorkspaceMessage, pubkey: string) {
  return event.pubkey.toLowerCase() !== pubkey.toLowerCase();
}

function isConversationalMessage(event: WorkspaceMessage) {
  return event.kind === 9 || event.kind === 40002;
}

function readMarkerForEvent(
  markers: ReadonlyMap<string, number>,
  channelId: string,
  event: WorkspaceMessage,
) {
  return Math.max(
    markers.get(channelId) ?? 0,
    markers.get(`msg:${event.id}`) ?? 0,
    event.rootEventId ? (markers.get(`thread:${event.rootEventId}`) ?? 0) : 0,
  );
}

function categoryForMessage(args: {
  event: WorkspaceMessage;
  participatedThreadRootIds: ReadonlySet<string>;
  pubkey: string;
  channel?: WorkspaceChannel;
}): WorkspaceInboxCategory | null {
  const { channel, event, participatedThreadRootIds, pubkey } = args;
  if (isTargetedApprovalRequest(event, pubkey)) {
    return "needs_action";
  }
  if (
    AGENT_ACTIVITY_KINDS.includes(
      event.kind as (typeof AGENT_ACTIVITY_KINDS)[number],
    ) &&
    event.tags.some(
      (tag) => tag[0] === "p" && tag[1]?.toLowerCase() === pubkey.toLowerCase(),
    )
  ) {
    return "agent_activity";
  }
  if (channel?.type === "dm" && isConversationalMessage(event)) {
    return "direct_message";
  }
  if (
    event.tags.some(
      (tag) => tag[0] === "p" && tag[1]?.toLowerCase() === pubkey.toLowerCase(),
    )
  ) {
    return "mention";
  }
  if (event.rootEventId && participatedThreadRootIds.has(event.rootEventId)) {
    return "reply";
  }
  // An ordinary chat post from an agent belongs in its channel. Do not turn it
  // into Inbox noise; only its addressed lifecycle events qualify above.
  return null;
}

function mapEventsByChannel(events: readonly WorkspaceMessage[]) {
  const result = new Map<string, WorkspaceMessage[]>();
  for (const event of events) {
    const eventsForChannel = result.get(event.channelId) ?? [];
    if (!eventsForChannel.some((known) => known.id === event.id)) {
      eventsForChannel.push(event);
      result.set(event.channelId, eventsForChannel);
    }
  }
  for (const eventsForChannel of result.values()) {
    eventsForChannel.sort(
      (left, right) =>
        left.created_at - right.created_at || left.id.localeCompare(right.id),
    );
  }
  return result;
}

function toWorkspaceMessage(event: NostrEvent): WorkspaceMessage {
  const rootEventId =
    event.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1] ?? null;
  const parentEventId =
    event.tags.find((tag) => tag[0] === "e" && tag[3] === "reply")?.[1] ??
    rootEventId;
  return {
    ...event,
    channelId: firstTag(event, "h") ?? `msg:${event.id}`,
    parentEventId,
    rootEventId,
  };
}

export function deriveWorkspaceUnread(args: {
  channels: readonly WorkspaceChannel[];
  eventsByChannel: ReadonlyMap<string, readonly WorkspaceMessage[]>;
  markers: ReadonlyMap<string, number>;
  pubkey: string;
}) {
  const { channels, eventsByChannel, markers, pubkey } = args;
  const channelsById = new Map(
    channels.map((channel) => [channel.id, channel]),
  );
  const participatedThreadRootIds = new Set<string>();
  for (const events of eventsByChannel.values()) {
    for (const event of events) {
      if (!isExternalMessage(event, pubkey)) {
        participatedThreadRootIds.add(event.rootEventId ?? event.id);
      }
    }
  }
  const unreadChannelIds = new Set<string>();
  const unreadChannelCounts = new Map<string, number>();
  const inboxItems: WorkspaceInboxItem[] = [];
  const alertItems: WorkspaceInboxItem[] = [];
  for (const [channelId, events] of eventsByChannel) {
    let unreadCount = 0;
    for (const event of events) {
      if (!isExternalMessage(event, pubkey)) continue;
      const isRead =
        event.created_at <= readMarkerForEvent(markers, channelId, event);
      if (!isRead && isConversationalMessage(event)) unreadCount += 1;
      const category = categoryForMessage({
        event,
        participatedThreadRootIds,
        pubkey,
        channel: channelsById.get(channelId),
      });
      if (category) {
        const dismissContextId = inboxDismissContextId(event.id);
        const item = {
          category,
          channelId: channelsById.has(channelId) ? channelId : null,
          content: event.content,
          contextId: channelId,
          dismissContextId,
          createdAt: event.created_at,
          id: event.id,
          isRead,
          pubkey: event.pubkey,
        } satisfies WorkspaceInboxItem;
        if (category === "mention" || category === "reply") {
          alertItems.push(item);
        } else if (
          category === "needs_action" &&
          isTargetedApprovalRequest(event, pubkey) &&
          (markers.get(dismissContextId) ?? 0) < event.created_at
        ) {
          inboxItems.push(item);
        }
      }
    }
    if (unreadCount > 0) {
      unreadChannelIds.add(channelId);
      unreadChannelCounts.set(channelId, unreadCount);
    }
  }
  return {
    alertItems: alertItems.sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    ),
    inboxItems: inboxItems.sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    ),
    unreadChannelCounts,
    unreadChannelIds,
  };
}

export function useWorkspaceReadState({
  channels,
  currentMessages,
  identityPubkey,
  activeChannelId,
}: {
  channels: readonly WorkspaceChannel[];
  currentMessages: readonly WorkspaceMessage[];
  identityPubkey?: string;
  activeChannelId: string | null;
}) {
  const [markers, setMarkers] = React.useState<Map<string, number>>(() =>
    identityPubkey ? readLocalWorkspaceReadState(identityPubkey) : new Map(),
  );
  const [eventsByChannel, setEventsByChannel] = React.useState<
    Map<string, readonly WorkspaceMessage[]>
  >(new Map());
  const publishTimerRef = React.useRef<number | null>(null);
  const markersRef = React.useRef(markers);
  markersRef.current = markers;

  const persistAndPublish = React.useCallback(
    (nextMarkers: Map<string, number>) => {
      if (!identityPubkey) return;
      writeLocalWorkspaceReadState(identityPubkey, nextMarkers);
      if (publishTimerRef.current !== null)
        window.clearTimeout(publishTimerRef.current);
      publishTimerRef.current = window.setTimeout(() => {
        publishTimerRef.current = null;
        void publishMarkers(identityPubkey, nextMarkers).catch(() => {
          // A local marker still guarantees consistent reload behaviour. The
          // next read action retries cross-device synchronization.
        });
      }, PUBLISH_DELAY_MS);
    },
    [identityPubkey],
  );

  React.useEffect(() => {
    if (!identityPubkey || channels.length === 0) return;
    let cancelled = false;
    const localMarkers = readLocalWorkspaceReadState(identityPubkey);
    const channelIds = channels.map((channel) => channel.id);
    void Promise.all([
      readRemoteMarkers(identityPubkey).catch(() => new Map<string, number>()),
      queryEvents(relayWsUrl(), {
        kinds: [...CONVERSATIONAL_KINDS],
        "#h": channelIds,
        limit: 1_000,
      }),
      queryEvents(relayWsUrl(), {
        kinds: [...INBOX_SOURCE_KINDS],
        "#p": [identityPubkey],
        limit: 500,
      }),
    ]).then(([remoteMarkers, channelEvents, inboxEvents]) => {
      if (cancelled) return;
      const mergedMarkers = mergeMarkers(localMarkers, remoteMarkers);
      const parsedEvents = [...channelEvents, ...inboxEvents]
        .filter(
          (event, index, all) =>
            all.findIndex((candidate) => candidate.id === event.id) === index,
        )
        .map(toWorkspaceMessage);
      const nextEvents = mapEventsByChannel(parsedEvents);
      // A first web visit must not replay the entire company history as new.
      // Existing desktop/mobile markers always win; absent markers seed to the
      // newest observed external message and subsequent activity is unread.
      for (const [channelId, channelEvents] of nextEvents) {
        if (mergedMarkers.has(channelId)) continue;
        const newestExternal = [...channelEvents]
          .reverse()
          .find((event) => isExternalMessage(event, identityPubkey));
        if (newestExternal)
          mergedMarkers.set(channelId, newestExternal.created_at);
      }
      setMarkers((current) => {
        const next = mergeMarkers(current, mergedMarkers);
        writeLocalWorkspaceReadState(identityPubkey, next);
        return next;
      });
      setEventsByChannel((current) =>
        mapEventsByChannel([
          ...[...current.values()].flat(),
          ...[...nextEvents.values()].flat(),
        ]),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [channels, identityPubkey]);

  React.useEffect(() => {
    if (!identityPubkey) return;
    return subscribeEvents(
      relayWsUrl(),
      {
        kinds: [KIND_READ_STATE],
        authors: [identityPubkey],
        "#t": ["read-state"],
        since: Math.floor(Date.now() / 1000),
      },
      (event) => {
        void (async () => {
          try {
            const plaintext = await nip44DecryptFromSelf(
              identityPubkey,
              event.content,
            );
            const blob = parseReadStateBlob(JSON.parse(plaintext));
            if (!blob) return;
            setMarkers((current) => {
              const next = mergeMarkers(
                current,
                new Map(Object.entries(blob.contexts)),
              );
              writeLocalWorkspaceReadState(identityPubkey, next);
              return next;
            });
          } catch {
            // Cross-device state is best-effort for NIP-07 signers without
            // NIP-44. Their own persistent local marker remains intact.
          }
        })();
      },
    );
  }, [identityPubkey]);

  const recordIncomingMessage = React.useCallback(
    (event: WorkspaceMessage) => {
      if (!identityPubkey) return;
      setEventsByChannel((current) => {
        const next = new Map(current);
        const existing = next.get(event.channelId) ?? [];
        if (existing.some((candidate) => candidate.id === event.id))
          return current;
        next.set(event.channelId, [...existing, event]);
        return next;
      });
      if (
        event.channelId !== activeChannelId ||
        !isExternalMessage(event, identityPubkey)
      )
        return;
      setMarkers((current) => {
        const timestamp = Math.max(
          current.get(event.channelId) ?? 0,
          event.created_at,
        );
        const next = new Map(current).set(event.channelId, timestamp);
        persistAndPublish(next);
        return next;
      });
    },
    [activeChannelId, identityPubkey, persistAndPublish],
  );

  React.useEffect(() => {
    if (!identityPubkey) return;
    return subscribeEvents(
      relayWsUrl(),
      {
        kinds: [...INBOX_SOURCE_KINDS],
        "#p": [identityPubkey],
        since: Math.floor(Date.now() / 1000),
      },
      (event) => recordIncomingMessage(toWorkspaceMessage(event)),
    );
  }, [identityPubkey, recordIncomingMessage]);

  const markChannelRead = React.useCallback(
    (channelId: string, timestamp?: number) => {
      const observed = eventsByChannel.get(channelId) ?? [];
      const newest = observed.reduce(
        (latest, event) =>
          isExternalMessage(event, identityPubkey ?? "")
            ? Math.max(latest, event.created_at)
            : latest,
        timestamp ?? 0,
      );
      if (newest === 0) return;
      setMarkers((current) => {
        if ((current.get(channelId) ?? 0) >= newest) return current;
        const next = new Map(current).set(channelId, newest);
        persistAndPublish(next);
        return next;
      });
    },
    [eventsByChannel, identityPubkey, persistAndPublish],
  );

  React.useEffect(() => {
    if (!activeChannelId || currentMessages.length === 0) return;
    const newestExternal = currentMessages
      .filter((message) => message.channelId === activeChannelId)
      .reduce(
        (latest, message) =>
          isExternalMessage(message, identityPubkey ?? "")
            ? Math.max(latest, message.created_at)
            : latest,
        0,
      );
    if (newestExternal > 0) markChannelRead(activeChannelId, newestExternal);
  }, [activeChannelId, currentMessages, identityPubkey, markChannelRead]);

  React.useEffect(
    () => () => {
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
        if (identityPubkey)
          void publishMarkers(identityPubkey, markersRef.current).catch(
            () => {},
          );
      }
    },
    [identityPubkey],
  );

  const unread = React.useMemo(
    () =>
      deriveWorkspaceUnread({
        channels,
        eventsByChannel,
        markers,
        pubkey: identityPubkey ?? "",
      }),
    [channels, eventsByChannel, identityPubkey, markers],
  );

  const markAllRead = React.useCallback(() => {
    const next = new Map(markers);
    for (const [channelId, events] of eventsByChannel) {
      const newest = events.reduce(
        (latest, event) =>
          isExternalMessage(event, identityPubkey ?? "")
            ? Math.max(latest, event.created_at)
            : latest,
        0,
      );
      if (newest > 0) next.set(channelId, newest);
    }
    setMarkers(next);
    persistAndPublish(next);
  }, [eventsByChannel, identityPubkey, markers, persistAndPublish]);

  const markInboxItemRead = React.useCallback(
    (item: WorkspaceInboxItem) => {
      setMarkers((current) => {
        if ((current.get(item.contextId) ?? 0) >= item.createdAt) {
          return current;
        }
        const next = new Map(current).set(item.contextId, item.createdAt);
        persistAndPublish(next);
        return next;
      });
    },
    [persistAndPublish],
  );

  const dismissInboxItem = React.useCallback(
    (item: WorkspaceInboxItem) => {
      setMarkers((current) => {
        if ((current.get(item.dismissContextId) ?? 0) >= item.createdAt) {
          return current;
        }
        const next = new Map(current).set(
          item.dismissContextId,
          item.createdAt,
        );
        persistAndPublish(next);
        return next;
      });
    },
    [persistAndPublish],
  );

  const dismissAllInboxItems = React.useCallback(() => {
    setMarkers((current) => {
      const next = new Map(current);
      let changed = false;
      for (const item of unread.inboxItems) {
        if ((next.get(item.dismissContextId) ?? 0) < item.createdAt) {
          next.set(item.dismissContextId, item.createdAt);
          changed = true;
        }
      }
      if (!changed) return current;
      persistAndPublish(next);
      return next;
    });
  }, [persistAndPublish, unread.inboxItems]);

  return {
    alertItems: unread.alertItems,
    dismissAllInboxItems,
    dismissInboxItem,
    inboxItems: unread.inboxItems,
    markAllRead,
    markInboxItemRead,
    markChannelRead,
    recordIncomingMessage,
    unreadChannelCounts: unread.unreadChannelCounts,
    unreadChannelIds: unread.unreadChannelIds,
  };
}

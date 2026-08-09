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
  CHANNEL_MUTES_D_TAG,
  CHANNEL_MUTES_T_TAG,
  CHANNEL_STARS_D_TAG,
  CHANNEL_STARS_T_TAG,
  KIND_CHANNEL_MUTES,
  type ChannelDraftStore,
  type ChannelMuteStore,
  type ChannelStarStore,
  channelStateStorageKey,
  emptyChannelDraftStore,
  emptyChannelMuteStore,
  emptyChannelStarStore,
  compareNewestReplaceableHead,
  mergeChannelMuteStores,
  mergeChannelStarStores,
  nextChannelStateCreatedAt,
  parseChannelDraftStore,
  parseChannelMuteStore,
  parseChannelStarStore,
  userEventListTemplate,
} from "./channel-state-policy";

function newest(events: readonly NostrEvent[]): NostrEvent | null {
  return [...events].sort(compareNewestReplaceableHead)[0] ?? null;
}

export function readLocalChannelDrafts(pubkey: string): ChannelDraftStore {
  try {
    return (
      parseChannelDraftStore(
        JSON.parse(
          localStorage.getItem(
            channelStateStorageKey("drafts", relayWsUrl(), pubkey),
          ) ?? "",
        ),
      ) ?? emptyChannelDraftStore()
    );
  } catch {
    return emptyChannelDraftStore();
  }
}

export function writeLocalChannelDrafts(
  pubkey: string,
  store: ChannelDraftStore,
) {
  localStorage.setItem(
    channelStateStorageKey("drafts", relayWsUrl(), pubkey),
    JSON.stringify(store),
  );
}

export function readLocalChannelMutes(pubkey: string): ChannelMuteStore {
  try {
    return (
      parseChannelMuteStore(
        JSON.parse(
          localStorage.getItem(
            channelStateStorageKey("mutes", relayWsUrl(), pubkey),
          ) ?? "",
        ),
      ) ?? emptyChannelMuteStore()
    );
  } catch {
    return emptyChannelMuteStore();
  }
}

export function writeLocalChannelMutes(
  pubkey: string,
  store: ChannelMuteStore,
) {
  localStorage.setItem(
    channelStateStorageKey("mutes", relayWsUrl(), pubkey),
    JSON.stringify(store),
  );
}

export function readLocalChannelStars(pubkey: string): ChannelStarStore {
  try {
    return (
      parseChannelStarStore(
        JSON.parse(
          localStorage.getItem(
            channelStateStorageKey("stars", relayWsUrl(), pubkey),
          ) ?? "",
        ),
      ) ?? emptyChannelStarStore()
    );
  } catch {
    return emptyChannelStarStore();
  }
}

export function writeLocalChannelStars(
  pubkey: string,
  store: ChannelStarStore,
) {
  localStorage.setItem(
    channelStateStorageKey("stars", relayWsUrl(), pubkey),
    JSON.stringify(store),
  );
}

/** Read the exact author/d-tag NIP-78 channel mute head and decrypt it. */
export async function readRemoteChannelMutes(
  pubkey: string,
): Promise<ChannelMuteStore> {
  const head = newest(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_CHANNEL_MUTES],
      authors: [pubkey.toLowerCase()],
      "#d": [CHANNEL_MUTES_D_TAG],
      limit: 20,
    }),
  );
  if (!head || head.pubkey.toLowerCase() !== pubkey.toLowerCase()) {
    return emptyChannelMuteStore();
  }
  const dTags = head.tags.filter((tag) => tag[0] === "d");
  const typeTags = head.tags.filter((tag) => tag[0] === "t");
  if (
    dTags.length !== 1 ||
    dTags[0]?.length !== 2 ||
    dTags[0]?.[1] !== CHANNEL_MUTES_D_TAG ||
    typeTags.length !== 1 ||
    typeTags[0]?.length !== 2 ||
    typeTags[0]?.[1] !== CHANNEL_MUTES_T_TAG
  ) {
    return emptyChannelMuteStore();
  }
  try {
    return (
      parseChannelMuteStore(
        JSON.parse(await nip44DecryptFromSelf(pubkey, head.content)),
      ) ?? emptyChannelMuteStore()
    );
  } catch {
    return emptyChannelMuteStore();
  }
}

/** Publish the desktop-compatible encrypted channel mute coordinate. */
export async function publishChannelMutes(
  pubkey: string,
  store: ChannelMuteStore,
) {
  localStorage.setItem(
    channelStateStorageKey("mute-outbox", relayWsUrl(), pubkey),
    JSON.stringify(store),
  );
  return flushChannelMuteOutbox(pubkey);
}

function readMuteOutbox(pubkey: string): ChannelMuteStore | null {
  try {
    return parseChannelMuteStore(
      JSON.parse(
        localStorage.getItem(
          channelStateStorageKey("mute-outbox", relayWsUrl(), pubkey),
        ) ?? "",
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Merge the durable local outbox with the current relay head before every
 * publication. This ports desktop's race-safe NIP-33 behavior: a fresh
 * timestamp is strictly later than the observed head, and a failed publish is
 * retained for the next mount or explicit retry instead of being dropped.
 */
export async function flushChannelMuteOutbox(pubkey: string) {
  const pending = readMuteOutbox(pubkey);
  if (!pending) return null;
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_CHANNEL_MUTES],
    authors: [pubkey.toLowerCase()],
    "#d": [CHANNEL_MUTES_D_TAG],
    limit: 20,
  });
  const head = newest(events);
  let remote = emptyChannelMuteStore();
  if (head?.pubkey.toLowerCase() === pubkey.toLowerCase()) {
    const dTags = head.tags.filter((tag) => tag[0] === "d");
    const typeTags = head.tags.filter((tag) => tag[0] === "t");
    if (
      dTags.length === 1 &&
      dTags[0]?.length === 2 &&
      dTags[0]?.[1] === CHANNEL_MUTES_D_TAG &&
      typeTags.length === 1 &&
      typeTags[0]?.length === 2 &&
      typeTags[0]?.[1] === CHANNEL_MUTES_T_TAG
    ) {
      try {
        remote =
          parseChannelMuteStore(
            JSON.parse(await nip44DecryptFromSelf(pubkey, head.content)),
          ) ?? remote;
      } catch {
        /* invalid remote state never replaces local intent */
      }
    }
  }
  const merged = mergeChannelMuteStores(pending, remote);
  writeLocalChannelMutes(pubkey, merged);
  const content = await nip44EncryptToSelf(
    pubkey,
    JSON.stringify({ version: 1, channels: merged.channels }),
  );
  const published = await publishEvent(relayWsUrl(), {
    kind: KIND_CHANNEL_MUTES,
    content,
    tags: [
      ["d", CHANNEL_MUTES_D_TAG],
      ["t", CHANNEL_MUTES_T_TAG],
    ],
    created_at: nextChannelStateCreatedAt(
      Math.floor(Date.now() / 1_000),
      head?.created_at ?? 0,
    ),
  });
  localStorage.removeItem(
    channelStateStorageKey("mute-outbox", relayWsUrl(), pubkey),
  );
  return published;
}

export async function readRemoteChannelStars(
  pubkey: string,
): Promise<ChannelStarStore> {
  const head = newest(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_CHANNEL_MUTES],
      authors: [pubkey.toLowerCase()],
      "#d": [CHANNEL_STARS_D_TAG],
      limit: 20,
    }),
  );
  if (!head || head.pubkey.toLowerCase() !== pubkey.toLowerCase())
    return emptyChannelStarStore();
  const dTags = head.tags.filter((tag) => tag[0] === "d");
  const typeTags = head.tags.filter((tag) => tag[0] === "t");
  if (
    dTags.length !== 1 ||
    dTags[0]?.[1] !== CHANNEL_STARS_D_TAG ||
    typeTags.length !== 1 ||
    typeTags[0]?.length !== 2 ||
    typeTags[0]?.[1] !== CHANNEL_STARS_T_TAG
  )
    return emptyChannelStarStore();
  try {
    return (
      parseChannelStarStore(
        JSON.parse(await nip44DecryptFromSelf(pubkey, head.content)),
      ) ?? emptyChannelStarStore()
    );
  } catch {
    return emptyChannelStarStore();
  }
}

export async function publishChannelStars(
  pubkey: string,
  store: ChannelStarStore,
) {
  localStorage.setItem(
    channelStateStorageKey("star-outbox", relayWsUrl(), pubkey),
    JSON.stringify(store),
  );
  return flushChannelStarOutbox(pubkey);
}

function readStarOutbox(pubkey: string): ChannelStarStore | null {
  try {
    return parseChannelStarStore(
      JSON.parse(
        localStorage.getItem(
          channelStateStorageKey("star-outbox", relayWsUrl(), pubkey),
        ) ?? "",
      ),
    );
  } catch {
    return null;
  }
}

/** The `channel-stars` register has the same merge/outbox semantics as mutes. */
export async function flushChannelStarOutbox(pubkey: string) {
  const pending = readStarOutbox(pubkey);
  if (!pending) return null;
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_CHANNEL_MUTES],
    authors: [pubkey.toLowerCase()],
    "#d": [CHANNEL_STARS_D_TAG],
    limit: 20,
  });
  const head = newest(events);
  let remote = emptyChannelStarStore();
  if (head?.pubkey.toLowerCase() === pubkey.toLowerCase()) {
    const dTags = head.tags.filter((tag) => tag[0] === "d");
    const typeTags = head.tags.filter((tag) => tag[0] === "t");
    if (
      dTags.length === 1 &&
      dTags[0]?.length === 2 &&
      dTags[0]?.[1] === CHANNEL_STARS_D_TAG &&
      typeTags.length === 1 &&
      typeTags[0]?.length === 2 &&
      typeTags[0]?.[1] === CHANNEL_STARS_T_TAG
    ) {
      try {
        remote =
          parseChannelStarStore(
            JSON.parse(await nip44DecryptFromSelf(pubkey, head.content)),
          ) ?? remote;
      } catch {
        // Invalid remote state cannot replace the local user intent.
      }
    }
  }
  const merged = mergeChannelStarStores(pending, remote);
  writeLocalChannelStars(pubkey, merged);
  const published = await publishEvent(relayWsUrl(), {
    kind: KIND_CHANNEL_MUTES,
    content: await nip44EncryptToSelf(
      pubkey,
      JSON.stringify({ version: 1, channels: merged.channels }),
    ),
    tags: [
      ["d", CHANNEL_STARS_D_TAG],
      ["t", CHANNEL_STARS_T_TAG],
    ],
    created_at: nextChannelStateCreatedAt(
      Math.floor(Date.now() / 1_000),
      head?.created_at ?? 0,
    ),
  });
  localStorage.removeItem(
    channelStateStorageKey("star-outbox", relayWsUrl(), pubkey),
  );
  return published;
}

export function subscribeToChannelStars(
  pubkey: string,
  onStore: (store: ChannelStarStore) => void,
) {
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_CHANNEL_MUTES],
      authors: [pubkey.toLowerCase()],
      "#d": [CHANNEL_STARS_D_TAG],
      since: Math.floor(Date.now() / 1_000),
    },
    (event) => {
      if (event.pubkey.toLowerCase() !== pubkey.toLowerCase()) return;
      const dTags = event.tags.filter((tag) => tag[0] === "d");
      const typeTags = event.tags.filter((tag) => tag[0] === "t");
      if (
        dTags.length !== 1 ||
        dTags[0]?.length !== 2 ||
        dTags[0]?.[1] !== CHANNEL_STARS_D_TAG ||
        typeTags.length !== 1 ||
        typeTags[0]?.length !== 2 ||
        typeTags[0]?.[1] !== CHANNEL_STARS_T_TAG
      ) {
        return;
      }
      void nip44DecryptFromSelf(pubkey, event.content)
        .then((plaintext) => parseChannelStarStore(JSON.parse(plaintext)))
        .then((store) => {
          if (store) onStore(store);
        })
        .catch(() => {});
    },
  );
}

function newestUserList(events: readonly NostrEvent[]) {
  return newest(events);
}
export async function listUserEventReferences(
  pubkey: string,
  kind: 10001 | 10003,
) {
  const head = newestUserList(
    await queryEvents(relayWsUrl(), {
      kinds: [kind],
      authors: [pubkey.toLowerCase()],
      limit: 20,
    }),
  );
  return (
    head?.tags
      .filter((tag) => tag[0] === "e" && /^[0-9a-f]{64}$/i.test(tag[1] ?? ""))
      .map((tag) => tag[1].toLowerCase()) ?? []
  );
}
export async function setUserEventReference(
  pubkey: string,
  kind: 10001 | 10003,
  eventId: string,
  active: boolean,
) {
  const head = newestUserList(
    await queryEvents(relayWsUrl(), {
      kinds: [kind],
      authors: [pubkey.toLowerCase()],
      limit: 20,
    }),
  );
  return publishEvent(
    relayWsUrl(),
    userEventListTemplate(kind, head?.tags ?? [], eventId, active),
  );
}

export function subscribeToUserEventReferences(
  pubkey: string,
  kind: 10001 | 10003,
  onUpdate: () => void,
) {
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [kind],
      authors: [pubkey.toLowerCase()],
      since: Math.floor(Date.now() / 1_000),
    },
    () => onUpdate(),
  );
}

export function subscribeToChannelMutes(
  pubkey: string,
  onStore: (store: ChannelMuteStore) => void,
) {
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_CHANNEL_MUTES],
      authors: [pubkey.toLowerCase()],
      "#d": [CHANNEL_MUTES_D_TAG],
      since: Math.floor(Date.now() / 1_000),
    },
    (event) => {
      if (event.pubkey.toLowerCase() !== pubkey.toLowerCase()) return;
      const dTags = event.tags.filter((tag) => tag[0] === "d");
      const typeTags = event.tags.filter((tag) => tag[0] === "t");
      if (
        dTags.length !== 1 ||
        dTags[0]?.length !== 2 ||
        dTags[0]?.[1] !== CHANNEL_MUTES_D_TAG ||
        typeTags.length !== 1 ||
        typeTags[0]?.length !== 2 ||
        typeTags[0]?.[1] !== CHANNEL_MUTES_T_TAG
      ) {
        return;
      }
      void (async () => {
        try {
          const parsed = parseChannelMuteStore(
            JSON.parse(await nip44DecryptFromSelf(pubkey, event.content)),
          );
          if (parsed) onStore(parsed);
        } catch {
          // An un-decryptable event cannot replace valid local state.
        }
      })();
    },
  );
}

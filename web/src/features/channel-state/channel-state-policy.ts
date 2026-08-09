export const KIND_CHANNEL_MUTES = 30078;
export const CHANNEL_MUTES_D_TAG = "channel-mutes";
export const CHANNEL_MUTES_T_TAG = "channel-mutes";
export const CHANNEL_STARS_D_TAG = "channel-stars";
export const CHANNEL_STARS_T_TAG = "channel-stars";

export type ChannelMuteEntry = { muted: boolean; updatedAt: number };
export type ChannelMuteStore = {
  version: 1;
  channels: Record<string, ChannelMuteEntry>;
};

export type ChannelStarEntry = { starred: boolean; updatedAt: number };
export type ChannelStarStore = {
  version: 1;
  channels: Record<string, ChannelStarEntry>;
};

export type ChannelDraft = {
  content: string;
  updatedAt: number;
};

export type ChannelDraftStore = {
  version: 1;
  drafts: Record<string, ChannelDraft>;
};

export const emptyChannelMuteStore = (): ChannelMuteStore => ({
  version: 1,
  channels: {},
});

export const emptyChannelDraftStore = (): ChannelDraftStore => ({
  version: 1,
  drafts: {},
});
export const emptyChannelStarStore = (): ChannelStarStore => ({
  version: 1,
  channels: {},
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parse the shared desktop/browser encrypted channel-mutes payload strictly. */
export function parseChannelMuteStore(value: unknown): ChannelMuteStore | null {
  if (
    !isPlainObject(value) ||
    value.version !== 1 ||
    !isPlainObject(value.channels)
  ) {
    return null;
  }
  const channels: Record<string, ChannelMuteEntry> = {};
  for (const [channelId, candidate] of Object.entries(value.channels)) {
    if (
      channelId.length === 0 ||
      channelId.length > 256 ||
      !isPlainObject(candidate) ||
      typeof candidate.muted !== "boolean" ||
      typeof candidate.updatedAt !== "number" ||
      !Number.isFinite(candidate.updatedAt) ||
      candidate.updatedAt < 0
    ) {
      continue;
    }
    channels[channelId] = {
      muted: candidate.muted,
      updatedAt: candidate.updatedAt,
    };
  }
  return { version: 1, channels };
}

/** Per-channel newest wins; local wins an equal timestamp deterministically. */
export function mergeChannelMuteStores(
  local: ChannelMuteStore,
  remote: ChannelMuteStore,
): ChannelMuteStore {
  const channels: Record<string, ChannelMuteEntry> = {};
  for (const channelId of new Set([
    ...Object.keys(local.channels),
    ...Object.keys(remote.channels),
  ])) {
    const left = local.channels[channelId];
    const right = remote.channels[channelId];
    if (left && right)
      channels[channelId] = left.updatedAt >= right.updatedAt ? left : right;
    else if (left) channels[channelId] = left;
    else if (right) channels[channelId] = right;
  }
  return { version: 1, channels };
}

/** Parse the desktop-compatible encrypted `channel-stars` NIP-78 payload. */
export function parseChannelStarStore(value: unknown): ChannelStarStore | null {
  if (
    !isPlainObject(value) ||
    value.version !== 1 ||
    !isPlainObject(value.channels)
  ) {
    return null;
  }
  const channels: Record<string, ChannelStarEntry> = {};
  for (const [channelId, candidate] of Object.entries(value.channels)) {
    if (
      channelId.length === 0 ||
      channelId.length > 256 ||
      !isPlainObject(candidate) ||
      typeof candidate.starred !== "boolean" ||
      typeof candidate.updatedAt !== "number" ||
      !Number.isFinite(candidate.updatedAt) ||
      candidate.updatedAt < 0
    )
      continue;
    channels[channelId] = {
      starred: candidate.starred,
      updatedAt: candidate.updatedAt,
    };
  }
  return { version: 1, channels };
}

export function mergeChannelStarStores(
  local: ChannelStarStore,
  remote: ChannelStarStore,
): ChannelStarStore {
  const channels: Record<string, ChannelStarEntry> = {};
  for (const channelId of new Set([
    ...Object.keys(local.channels),
    ...Object.keys(remote.channels),
  ])) {
    const left = local.channels[channelId];
    const right = remote.channels[channelId];
    if (left && right)
      channels[channelId] = left.updatedAt >= right.updatedAt ? left : right;
    else if (left) channels[channelId] = left;
    else if (right) channels[channelId] = right;
  }
  return { version: 1, channels };
}

/**
 * NIP-16 parameterized-replaceable heads sort by timestamp descending, then
 * event id ascending. Keeping this comparator here prevents a web client from
 * selecting the opposite same-second head from desktop or the relay database.
 */
export function compareNewestReplaceableHead(
  left: { created_at: number; id: string },
  right: { created_at: number; id: string },
) {
  if (left.created_at !== right.created_at) {
    return right.created_at - left.created_at;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** NIP-51 event references are profile-level, so they never carry `h`. */
export function normalizeUserEventReference(eventId: string) {
  const normalized = eventId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized))
    throw new Error(
      "Pin and bookmark actions require a 64-character event id.",
    );
  return normalized;
}

export function userEventListTemplate(
  kind: 10001 | 10003,
  knownTags: readonly string[][],
  eventId: string,
  active: boolean,
) {
  const target = normalizeUserEventReference(eventId);
  const otherTags = knownTags.filter((tag) => tag[0] !== "e" && tag[0] !== "h");
  const eventTags = knownTags
    .filter(
      (tag) =>
        tag[0] === "e" &&
        typeof tag[1] === "string" &&
        /^[0-9a-f]{64}$/i.test(tag[1]),
    )
    .map((tag) => ["e", tag[1].toLowerCase()]);
  const ids = new Set(eventTags.map((tag) => tag[1]));
  if (active) ids.add(target);
  else ids.delete(target);
  return {
    kind,
    content: "",
    tags: [...otherTags, ...[...ids].sort().map((id) => ["e", id])],
  };
}

export function draftContextId(channelId: string, rootEventId?: string | null) {
  const channel = channelId.trim();
  if (!channel) throw new Error("A channel is required for a draft.");
  const root = rootEventId?.trim();
  return root ? `${channel}:thread:${root}` : `${channel}:channel`;
}

export function parseChannelDraftStore(
  value: unknown,
): ChannelDraftStore | null {
  if (
    !isPlainObject(value) ||
    value.version !== 1 ||
    !isPlainObject(value.drafts)
  ) {
    return null;
  }
  const drafts: Record<string, ChannelDraft> = {};
  for (const [context, candidate] of Object.entries(value.drafts)) {
    if (
      context.length === 0 ||
      context.length > 512 ||
      !isPlainObject(candidate) ||
      typeof candidate.content !== "string" ||
      candidate.content.length > 64 * 1024 ||
      typeof candidate.updatedAt !== "number" ||
      !Number.isFinite(candidate.updatedAt) ||
      candidate.updatedAt < 0
    ) {
      continue;
    }
    drafts[context] = {
      content: candidate.content,
      updatedAt: candidate.updatedAt,
    };
  }
  return { version: 1, drafts };
}

export function channelStateStorageKey(
  kind: "drafts" | "mutes" | "stars" | "mute-outbox" | "star-outbox",
  relayUrl: string,
  pubkey: string,
) {
  return `buzz.web.channel-state.v1:${kind}:${relayUrl.toLowerCase()}:${pubkey.toLowerCase()}`;
}

/** Mirror desktop's NIP-33 monotonic timestamp rule for an observed remote head. */
export function nextChannelStateCreatedAt(
  nowSeconds: number,
  remoteCreatedAt: number,
) {
  return Math.max(nowSeconds, remoteCreatedAt + 1);
}

import type { NostrEvent } from "@/shared/lib/nostr-client";

export const OFFLINE_ARCHIVE_SCHEMA_VERSION = 1;
export const OFFLINE_ARCHIVE_RECORD_LIMIT = 10_000;
export const OFFLINE_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;
export const OFFLINE_ARCHIVE_EVENT_MAX_BYTES = 256 * 1024;
export const OFFLINE_ARCHIVE_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * This archive deliberately starts with normal channel traffic only. The
 * browser never decrypts or stores user-private relay kinds, gift wraps, or
 * owner-only observer frames while building an offline cache.
 */
export const ARCHIVABLE_CHANNEL_KINDS = [
  5, 7, 9, 40002, 40003, 40099, 9005,
] as const;

export type OfflineArchiveCursor = {
  createdAt: number;
  id: string;
};

export type OfflineArchiveEvent = Pick<
  NostrEvent,
  "id" | "pubkey" | "kind" | "content" | "created_at" | "tags" | "sig"
>;

export type OfflineArchiveScope = {
  relayUrl: string;
  pubkey: string;
};

function isLowercaseHex(value: string, length: number) {
  return new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function isTag(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((part) => typeof part === "string") &&
    value.length <= 16
  );
}

/** A stable local storage partition. It must never be used cross-relay. */
export function offlineArchiveScope({ relayUrl, pubkey }: OfflineArchiveScope) {
  let relay: URL;
  try {
    relay = new URL(relayUrl);
  } catch {
    throw new Error("Offline archive requires a valid relay URL.");
  }
  if (!/^wss?:$/.test(relay.protocol)) {
    throw new Error("Offline archive requires a ws:// or wss:// relay URL.");
  }
  const normalizedPubkey = pubkey.trim().toLowerCase();
  if (!isLowercaseHex(normalizedPubkey, 64)) {
    throw new Error(
      "Offline archive requires an unlocked 64-character pubkey.",
    );
  }
  return `v${OFFLINE_ARCHIVE_SCHEMA_VERSION}:${relay.toString().toLowerCase()}:${normalizedPubkey}`;
}

/**
 * Verify an event is safe to persist without decryption. Events must be exact
 * ordinary channel traffic and include the same `h` scope used for a relay
 * subscription; receiving one through an unrelated in-memory cache is not
 * enough.
 */
export function archiveableChannelEvent(
  event: unknown,
): OfflineArchiveEvent | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const candidate = event as Partial<OfflineArchiveEvent>;
  if (
    typeof candidate.id !== "string" ||
    !isLowercaseHex(candidate.id, 64) ||
    typeof candidate.pubkey !== "string" ||
    !isLowercaseHex(candidate.pubkey.toLowerCase(), 64) ||
    typeof candidate.kind !== "number" ||
    !ARCHIVABLE_CHANNEL_KINDS.includes(
      candidate.kind as (typeof ARCHIVABLE_CHANNEL_KINDS)[number],
    ) ||
    typeof candidate.content !== "string" ||
    typeof candidate.created_at !== "number" ||
    !Number.isInteger(candidate.created_at) ||
    candidate.created_at < 0 ||
    typeof candidate.sig !== "string" ||
    !isLowercaseHex(candidate.sig, 128) ||
    !Array.isArray(candidate.tags) ||
    !candidate.tags.every(isTag)
  ) {
    return null;
  }
  const hTags = candidate.tags.filter((tag) => tag[0] === "h");
  if (hTags.length !== 1 || hTags[0]?.length !== 2 || !hTags[0]?.[1]?.trim()) {
    return null;
  }
  const serialized = JSON.stringify(candidate);
  if (
    new TextEncoder().encode(serialized).byteLength >
    OFFLINE_ARCHIVE_EVENT_MAX_BYTES
  ) {
    return null;
  }
  return {
    id: candidate.id,
    pubkey: candidate.pubkey.toLowerCase(),
    kind: candidate.kind,
    content: candidate.content,
    created_at: candidate.created_at,
    tags: candidate.tags.map((tag) => [...tag]),
    sig: candidate.sig,
  };
}

export function archiveChannelId(event: OfflineArchiveEvent) {
  return event.tags.find((tag) => tag[0] === "h")?.[1] ?? null;
}

/** Nostr's deterministic newest-first order for a local archive page. */
export function compareOfflineArchiveNewest(
  left: OfflineArchiveCursor,
  right: OfflineArchiveCursor,
) {
  return (
    right.createdAt - left.createdAt ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

export function isBeforeOfflineCursor(
  candidate: OfflineArchiveCursor,
  cursor: OfflineArchiveCursor,
) {
  return (
    candidate.createdAt < cursor.createdAt ||
    (candidate.createdAt === cursor.createdAt && candidate.id > cursor.id)
  );
}

export function validateArchivePassphrase(passphrase: string) {
  if (passphrase.length < 12) {
    throw new Error("Use an archive passphrase with at least 12 characters.");
  }
}

export function supportsOfflineArchive() {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    Boolean(crypto.subtle)
  );
}

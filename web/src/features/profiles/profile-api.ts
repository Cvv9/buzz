import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  isNewerReplaceableHead,
  mergeProfileContent,
  parseProfileContent,
  type ProfileFields,
} from "./profile-policy";

export const KIND_PROFILE = 0;
export const KIND_USER_STATUS = 30315;
export const USER_STATUS_IDENTIFIER = "general";

export type UserStatus = {
  text: string;
  emoji: string;
  updatedAt: number;
  eventId: string;
};

export type BrowserProfile = {
  pubkey: string;
  name: string;
  picture?: string;
  about?: string;
  aliases: string[];
};

export type ProfileDetail = {
  profile: BrowserProfile;
  status: UserStatus | null;
  /** Replaceable heads keep realtime updates from rewinding a newer cache. */
  profileEvent?: NostrEvent;
  statusEvent?: NostrEvent;
};

export type ProfileDraft = ProfileFields;

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function statusEventIsGeneral(event: NostrEvent): boolean {
  return event.tags.some(
    (tag) => tag[0] === "d" && tag[1] === USER_STATUS_IDENTIFIER,
  );
}

function isNewerEvent(candidate: NostrEvent, current: NostrEvent): boolean {
  return isNewerReplaceableHead(candidate, current);
}

export function newestEvent(events: NostrEvent[]): NostrEvent | undefined {
  return events.reduce<NostrEvent | undefined>(
    (current, candidate) =>
      !current || isNewerEvent(candidate, current) ? candidate : current,
    undefined,
  );
}

export function profileFromEvent(
  event: NostrEvent | undefined,
  pubkey: string,
): BrowserProfile {
  const content = event ? parseProfileContent(event.content) : {};
  const aliases = Array.isArray(content.aliases)
    ? content.aliases
        .map(asTrimmedString)
        .filter((alias): alias is string => Boolean(alias))
    : [];
  return {
    pubkey: pubkey.toLowerCase(),
    name:
      asTrimmedString(content.display_name) ??
      asTrimmedString(content.name) ??
      truncatePubkey(pubkey),
    picture: asTrimmedString(content.picture),
    about: asTrimmedString(content.about),
    aliases,
  };
}

export function userStatusFromEvent(
  event: NostrEvent | undefined,
): UserStatus | null {
  if (!event || !statusEventIsGeneral(event)) return null;
  const text = event.content.trim();
  const emoji = event.tags.find((tag) => tag[0] === "emoji")?.[1]?.trim() ?? "";
  return text || emoji
    ? { text, emoji, updatedAt: event.created_at, eventId: event.id }
    : null;
}

function normalizedPubkeys(pubkeys: string[]): string[] {
  return [...new Set(pubkeys.map((pubkey) => pubkey.toLowerCase()))]
    .filter((pubkey) => /^[0-9a-f]{64}$/.test(pubkey))
    .sort();
}

/** Query the current general-status head for a bounded set of rendered users. */
export async function listUserStatuses(
  pubkeys: string[],
): Promise<Map<string, UserStatus | null>> {
  const authors = normalizedPubkeys(pubkeys);
  const statuses = new Map<string, UserStatus | null>(
    authors.map((pubkey) => [pubkey, null]),
  );
  if (!authors.length) return statuses;
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_USER_STATUS],
    authors,
    "#d": [USER_STATUS_IDENTIFIER],
    limit: Math.min(authors.length * 2, 200),
  });
  const heads = new Map<string, NostrEvent>();
  for (const event of events) {
    const pubkey = event.pubkey.toLowerCase();
    const current = heads.get(pubkey);
    if (!current || isNewerEvent(event, current)) heads.set(pubkey, event);
  }
  for (const pubkey of authors) {
    statuses.set(pubkey, userStatusFromEvent(heads.get(pubkey)));
  }
  return statuses;
}

export async function fetchProfileDetail(
  pubkey: string,
): Promise<ProfileDetail> {
  const normalizedPubkey = pubkey.toLowerCase();
  const [profileEvents, statusEvents] = await Promise.all([
    queryEvents(relayWsUrl(), {
      kinds: [KIND_PROFILE],
      authors: [normalizedPubkey],
      limit: 20,
    }),
    queryEvents(relayWsUrl(), {
      kinds: [KIND_USER_STATUS],
      authors: [normalizedPubkey],
      "#d": [USER_STATUS_IDENTIFIER],
      limit: 20,
    }),
  ]);
  const profileEvent = newestEvent(profileEvents);
  const statusEvent = newestEvent(statusEvents);
  return {
    profile: profileFromEvent(profileEvent, normalizedPubkey),
    status: userStatusFromEvent(statusEvent),
    profileEvent,
    statusEvent,
  };
}

/**
 * Read, merge, then republish the caller's kind 0 profile. NIP-01 profiles
 * are a JSON object, so this prevents browser edits from dropping client- or
 * server-owned fields such as proof, nip05, website, and custom extensions.
 */
export async function publishProfile(
  pubkey: string,
  draft: ProfileDraft,
): Promise<NostrEvent> {
  const normalizedPubkey = pubkey.toLowerCase();
  const existing = await queryEvents(relayWsUrl(), {
    kinds: [KIND_PROFILE],
    authors: [normalizedPubkey],
    limit: 20,
  });
  const next = mergeProfileContent(newestEvent(existing)?.content ?? "", draft);

  return publishEvent(relayWsUrl(), {
    kind: KIND_PROFILE,
    content: JSON.stringify(next),
    tags: [],
  });
}

export function publishUserStatus(input: {
  text: string;
  emoji: string;
}): Promise<NostrEvent> {
  const text = input.text.trim();
  const emoji = input.emoji.trim();
  return publishEvent(relayWsUrl(), {
    kind: KIND_USER_STATUS,
    content: text,
    tags: [["d", USER_STATUS_IDENTIFIER], ...(emoji ? [["emoji", emoji]] : [])],
  });
}

export function subscribeToProfileDetail(
  pubkey: string,
  onProfile: (event: NostrEvent) => void,
  onStatus: (event: NostrEvent) => void,
): () => void {
  const normalizedPubkey = pubkey.toLowerCase();
  const stopProfile = subscribeEvents(
    relayWsUrl(),
    { kinds: [KIND_PROFILE], authors: [normalizedPubkey] },
    onProfile,
  );
  const stopStatus = subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_USER_STATUS],
      authors: [normalizedPubkey],
      "#d": [USER_STATUS_IDENTIFIER],
    },
    onStatus,
  );
  return () => {
    stopProfile();
    stopStatus();
  };
}

/** Subscribe to profile heads for currently rendered people. */
export function subscribeToProfiles(
  pubkeys: string[],
  onProfile: (event: NostrEvent) => void,
): () => void {
  const authors = normalizedPubkeys(pubkeys);
  if (!authors.length) return () => undefined;
  return subscribeEvents(
    relayWsUrl(),
    { kinds: [KIND_PROFILE], authors },
    onProfile,
  );
}

/** Subscribe to the current general-status projection for rendered people. */
export function subscribeToUserStatuses(
  pubkeys: string[],
  onStatus: (event: NostrEvent) => void,
): () => void {
  const authors = normalizedPubkeys(pubkeys);
  if (!authors.length) return () => undefined;
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_USER_STATUS],
      authors,
      "#d": [USER_STATUS_IDENTIFIER],
    },
    (event) => {
      if (statusEventIsGeneral(event)) onStatus(event);
    },
  );
}

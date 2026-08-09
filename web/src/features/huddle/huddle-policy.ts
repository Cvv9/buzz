import type { NostrEvent } from "@/shared/lib/nostr-client";

export const KIND_HUDDLE_REACTION = 24810;
export const KIND_HUDDLE_STARTED = 48100;
export const KIND_HUDDLE_PARTICIPANT_JOINED = 48101;
export const KIND_HUDDLE_PARTICIPANT_LEFT = 48102;
export const KIND_HUDDLE_ENDED = 48103;
export const KIND_HUDDLE_GUIDELINES = 48106;

export const HUDDLE_LIFECYCLE_KINDS = [
  KIND_HUDDLE_STARTED,
  KIND_HUDDLE_PARTICIPANT_JOINED,
  KIND_HUDDLE_PARTICIPANT_LEFT,
  KIND_HUDDLE_ENDED,
] as const;

export const HUDDLE_JOINABLE_WINDOW_SECONDS = 60 * 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBKEY_RE = /^[0-9a-f]{64}$/i;

export type HuddleLifecycleEvent = NostrEvent & {
  ephemeralChannelId: string;
};

export type HuddleSession = {
  ephemeralChannelId: string;
  startedAt: number;
  startedBy: string;
  startedEventId: string;
  endedAt: number | null;
  participants: string[];
};

export function isHuddleChannelId(value: string): boolean {
  return UUID_RE.test(value);
}

function singleTagValue(event: Pick<NostrEvent, "tags">, name: string) {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 ? (tags[0]?.[1] ?? null) : null;
}

function parseEphemeralChannelId(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { ephemeral_channel_id?: unknown };
    return typeof parsed.ephemeral_channel_id === "string" &&
      isHuddleChannelId(parsed.ephemeral_channel_id)
      ? parsed.ephemeral_channel_id.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/**
 * The relay scopes lifecycle events to the parent channel. This parser makes
 * the `h` tag and the signed content agree before the event affects UI state.
 */
export function parseHuddleLifecycleEvent(
  event: NostrEvent,
  parentChannelId: string,
): HuddleLifecycleEvent | null {
  if (
    !HUDDLE_LIFECYCLE_KINDS.includes(
      event.kind as (typeof HUDDLE_LIFECYCLE_KINDS)[number],
    ) ||
    singleTagValue(event, "h") !== parentChannelId
  ) {
    return null;
  }
  const ephemeralChannelId = parseEphemeralChannelId(event.content);
  if (!ephemeralChannelId || !PUBKEY_RE.test(event.pubkey)) return null;
  if (
    (event.kind === KIND_HUDDLE_PARTICIPANT_JOINED ||
      event.kind === KIND_HUDDLE_PARTICIPANT_LEFT) &&
    !PUBKEY_RE.test(singleTagValue(event, "p") ?? "")
  ) {
    return null;
  }
  return { ...event, ephemeralChannelId };
}

function isNewerEvent(candidate: NostrEvent, current: NostrEvent): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}

/**
 * Project ordered lifecycle history into active/ended sessions. Events are
 * de-duplicated by id and equal timestamps retain the NIP-01 lowest-id order.
 */
export function foldHuddleLifecycle(
  events: Iterable<NostrEvent>,
  parentChannelId: string,
): HuddleSession[] {
  const byId = new Map<string, HuddleLifecycleEvent>();
  for (const event of events) {
    const parsed = parseHuddleLifecycleEvent(event, parentChannelId);
    if (!parsed) continue;
    const existing = byId.get(parsed.id);
    if (!existing || isNewerEvent(parsed, existing))
      byId.set(parsed.id, parsed);
  }

  const sessions = new Map<string, HuddleSession>();
  const ordered = [...byId.values()].sort(
    (left, right) =>
      left.created_at - right.created_at || left.id.localeCompare(right.id),
  );
  for (const event of ordered) {
    const existing = sessions.get(event.ephemeralChannelId);
    if (event.kind === KIND_HUDDLE_STARTED) {
      sessions.set(event.ephemeralChannelId, {
        ephemeralChannelId: event.ephemeralChannelId,
        startedAt: event.created_at,
        startedBy: event.pubkey.toLowerCase(),
        startedEventId: event.id,
        endedAt: null,
        participants: [event.pubkey.toLowerCase()],
      });
      continue;
    }
    if (!existing || existing.endedAt !== null) continue;
    if (event.kind === KIND_HUDDLE_ENDED) {
      existing.endedAt = event.created_at;
      existing.participants = [];
      continue;
    }
    const participant = singleTagValue(event, "p")?.toLowerCase();
    if (!participant) continue;
    if (event.kind === KIND_HUDDLE_PARTICIPANT_JOINED) {
      if (!existing.participants.includes(participant)) {
        existing.participants.push(participant);
      }
    } else if (event.kind === KIND_HUDDLE_PARTICIPANT_LEFT) {
      existing.participants = existing.participants.filter(
        (pubkey) => pubkey !== participant,
      );
    }
  }
  return [...sessions.values()].sort(
    (left, right) =>
      right.startedAt - left.startedAt ||
      left.startedEventId.localeCompare(right.startedEventId),
  );
}

export function canJoinHuddle(session: HuddleSession, nowMs = Date.now()) {
  return (
    session.endedAt === null &&
    nowMs / 1_000 - session.startedAt <= HUDDLE_JOINABLE_WINDOW_SECONDS
  );
}

/** The latest guideline is deterministic when relays replay equal timestamps. */
export function newestHuddleGuideline(
  events: Iterable<NostrEvent>,
  ephemeralChannelId: string,
): NostrEvent | null {
  let latest: NostrEvent | null = null;
  for (const event of events) {
    if (
      event.kind !== KIND_HUDDLE_GUIDELINES ||
      singleTagValue(event, "h")?.toLowerCase() !==
        ephemeralChannelId.toLowerCase() ||
      !event.content.trim()
    ) {
      continue;
    }
    if (!latest || isNewerEvent(event, latest)) latest = event;
  }
  return latest;
}

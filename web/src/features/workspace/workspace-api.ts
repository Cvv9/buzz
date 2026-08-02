import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { verifyEvent } from "nostr-tools";

export const KIND_PROFILE = 0;
export const KIND_DELETION = 5;
export const KIND_REACTION = 7;
export const KIND_STREAM_MESSAGE = 9;
export const KIND_AGENT_PROFILE = 10100;
export const KIND_ARCHIVED_IDENTITIES = 13535;
export const KIND_CHANNEL_METADATA = 39000;
export const KIND_CHANNEL_MEMBERS = 39002;
export const KIND_STREAM_MESSAGE_V2 = 40002;
export const KIND_STREAM_MESSAGE_EDIT = 40003;
export const KIND_SYSTEM_MESSAGE = 40099;
export const KIND_MANAGED_AGENT = 30177;
export const KIND_NIP29_DELETE = 9005;

const MESSAGE_KINDS = [
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_SYSTEM_MESSAGE,
  KIND_DELETION,
  KIND_NIP29_DELETE,
];

export function isConversationalWorkspaceMessage(
  event: Pick<NostrEvent, "kind">,
): boolean {
  return (
    event.kind === KIND_STREAM_MESSAGE || event.kind === KIND_STREAM_MESSAGE_V2
  );
}

export type WorkspaceChannel = {
  id: string;
  name: string;
  about: string;
  topic: string;
  type: "stream" | "forum" | "dm";
  visibility: "public" | "private";
  role: string;
  memberPubkeys: string[];
};

export type WorkspaceProfile = {
  pubkey: string;
  name: string;
  picture?: string;
  about?: string;
  isAgent?: boolean;
  audience?: "community" | "owner";
  ownerPubkey?: string;
  accessTier?: "shared" | "personal" | "admin";
};

export type WorkspaceMessage = NostrEvent & {
  channelId: string;
  rootEventId: string | null;
  parentEventId: string | null;
};

export type ReactionSummary = {
  eventId: string;
  emoji: string;
  authors: string[];
};

function firstTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function allTags(event: NostrEvent, name: string): string[][] {
  return event.tags.filter((tag) => tag[0] === name);
}

function dedupeReplaceable(events: NostrEvent[]): NostrEvent[] {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const key = `${event.kind}:${event.pubkey}:${firstTag(event, "d") ?? ""}`;
    const current = latest.get(key);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id > current.id)
    ) {
      latest.set(key, event);
    }
  }
  return [...latest.values()];
}

function parseThread(event: NostrEvent): {
  rootEventId: string | null;
  parentEventId: string | null;
} {
  const references = allTags(event, "e");
  const root = references.find((tag) => tag[3] === "root")?.[1];
  const reply = references.find((tag) => tag[3] === "reply")?.[1];
  if (root) return { rootEventId: root, parentEventId: reply ?? root };
  if (reply) return { rootEventId: reply, parentEventId: reply };
  return { rootEventId: null, parentEventId: null };
}

function parseMessage(event: NostrEvent): WorkspaceMessage {
  return {
    ...event,
    channelId: firstTag(event, "h") ?? "",
    ...parseThread(event),
  };
}

export async function listWorkspaceChannels(
  pubkey: string,
): Promise<WorkspaceChannel[]> {
  const memberships = dedupeReplaceable(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_CHANNEL_MEMBERS],
      "#p": [pubkey],
      limit: 500,
    }),
  );
  const channelIds = [
    ...new Set(
      memberships
        .map((event) => firstTag(event, "d"))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (channelIds.length === 0) return [];
  const metadata = dedupeReplaceable(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_CHANNEL_METADATA],
      "#d": channelIds,
      limit: 500,
    }),
  );
  const membershipByChannel = new Map(
    memberships.map((event) => [firstTag(event, "d"), event]),
  );
  return metadata
    .map((event): WorkspaceChannel | null => {
      const id = firstTag(event, "d");
      if (!id || firstTag(event, "archived") === "true") return null;
      const membership = membershipByChannel.get(id);
      const memberTags = membership ? allTags(membership, "p") : [];
      const ownTag = memberTags.find((tag) => tag[1] === pubkey);
      const type = firstTag(event, "t");
      return {
        id,
        name: firstTag(event, "name") || "untitled",
        about: firstTag(event, "about") || "",
        topic: firstTag(event, "topic") || "",
        type: type === "dm" || type === "forum" ? type : "stream",
        visibility: event.tags.some((tag) => tag[0] === "private")
          ? "private"
          : "public",
        role: ownTag?.[3] || ownTag?.[2] || "member",
        memberPubkeys: memberTags
          .map((tag) => tag[1])
          .filter((value): value is string => Boolean(value)),
      };
    })
    .filter((channel): channel is WorkspaceChannel => channel !== null)
    .sort((a, b) => {
      if (a.type === "dm" && b.type !== "dm") return 1;
      if (a.type !== "dm" && b.type === "dm") return -1;
      return a.name.localeCompare(b.name);
    });
}

export async function listChannelMessages(
  channelId: string,
): Promise<WorkspaceMessage[]> {
  const events = await queryEvents(relayWsUrl(), {
    kinds: MESSAGE_KINDS,
    "#h": [channelId],
    limit: 500,
  });
  return events
    .map(parseMessage)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

export async function listProfiles(
  pubkeys: string[],
): Promise<Map<string, WorkspaceProfile>> {
  const unique = [...new Set(pubkeys.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const events = dedupeReplaceable(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_PROFILE, KIND_AGENT_PROFILE, KIND_MANAGED_AGENT],
      authors: unique,
      limit: Math.min(500, unique.length * 3),
    }),
  );
  const profiles = new Map<string, WorkspaceProfile>();
  for (const event of events) {
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      // A malformed profile should not prevent the workspace from loading.
    }
    const existing = profiles.get(event.pubkey);
    const name =
      String(
        content.display_name ||
          content.name ||
          content.displayName ||
          existing?.name ||
          truncatePubkey(event.pubkey),
      ).trim() || truncatePubkey(event.pubkey);
    profiles.set(event.pubkey, {
      pubkey: event.pubkey,
      name,
      picture:
        typeof content.picture === "string"
          ? content.picture
          : typeof content.avatar_url === "string"
            ? content.avatar_url
            : existing?.picture,
      about:
        typeof content.about === "string" ? content.about : existing?.about,
      isAgent:
        existing?.isAgent ||
        event.kind === KIND_AGENT_PROFILE ||
        event.kind === KIND_MANAGED_AGENT,
    });
  }
  return profiles;
}

export async function listAgents(
  viewerPubkey: string,
): Promise<WorkspaceProfile[]> {
  const [agentEvents, archivedPubkeys] = await Promise.all([
    queryEvents(relayWsUrl(), {
      kinds: [KIND_AGENT_PROFILE, KIND_MANAGED_AGENT],
      limit: 200,
    }),
    listArchivedIdentities(),
  ]);
  const events = dedupeReplaceable(agentEvents);
  const agentPubkeys = events.map(
    (event) =>
      (event.kind === KIND_MANAGED_AGENT && firstTag(event, "d")) ||
      event.pubkey,
  );
  const profiles = await listProfiles(agentPubkeys);
  for (const event of events) {
    const pubkey =
      (event.kind === KIND_MANAGED_AGENT && firstTag(event, "d")) ||
      event.pubkey;
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      // Keep the authoritative event author/d-tag even with malformed content.
    }
    const existing = profiles.get(pubkey);
    profiles.set(pubkey, {
      pubkey,
      name:
        String(
          content.display_name ||
            content.name ||
            existing?.name ||
            truncatePubkey(pubkey),
        ).trim() || truncatePubkey(pubkey),
      picture:
        typeof content.picture === "string"
          ? content.picture
          : typeof content.avatar_url === "string"
            ? content.avatar_url
            : existing?.picture,
      about:
        typeof content.about === "string" ? content.about : existing?.about,
      isAgent: true,
      audience: content.audience === "owner" ? "owner" : "community",
      ownerPubkey:
        typeof content.owner_pubkey === "string"
          ? content.owner_pubkey
          : undefined,
      accessTier:
        content.access_tier === "personal" || content.access_tier === "admin"
          ? content.access_tier
          : "shared",
    });
  }
  return [...profiles.values()]
    .filter(
      (profile) =>
        !archivedPubkeys.has(profile.pubkey.toLowerCase()) &&
        (profile.audience !== "owner" || profile.ownerPubkey === viewerPubkey),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listArchivedIdentities(): Promise<Set<string>> {
  try {
    const infoResponse = await fetch(relayHttpBaseUrl(), {
      headers: { Accept: "application/nostr+json" },
    });
    if (!infoResponse.ok) return new Set();
    const info = (await infoResponse.json()) as { self?: unknown };
    if (typeof info.self !== "string" || !/^[0-9a-f]{64}$/i.test(info.self)) {
      return new Set();
    }
    const snapshots = await queryEvents(relayWsUrl(), {
      kinds: [KIND_ARCHIVED_IDENTITIES],
      authors: [info.self.toLowerCase()],
      limit: 50,
    });
    const snapshot = dedupeReplaceable(snapshots)[0];
    if (
      !snapshot ||
      snapshot.kind !== KIND_ARCHIVED_IDENTITIES ||
      snapshot.pubkey.toLowerCase() !== info.self.toLowerCase() ||
      !verifyEvent(snapshot) ||
      snapshot.tags.filter((tag) => tag.length === 1 && tag[0] === "-")
        .length !== 1
    ) {
      return new Set();
    }
    return new Set(
      snapshot.tags
        .filter(
          (tag) =>
            tag[0] === "p" &&
            typeof tag[1] === "string" &&
            /^[0-9a-f]{64}$/i.test(tag[1]),
        )
        .map((tag) => tag[1].toLowerCase()),
    );
  } catch {
    // Archive state is a visibility hint. Fail open if trust cannot be proven.
    return new Set();
  }
}

export async function listReactions(
  eventIds: string[],
): Promise<Map<string, ReactionSummary[]>> {
  if (eventIds.length === 0) return new Map();
  const reactions = await queryEvents(relayWsUrl(), {
    kinds: [KIND_REACTION],
    "#e": eventIds.slice(0, 500),
    limit: 500,
  });
  const grouped = new Map<string, Map<string, ReactionSummary>>();
  for (const reaction of reactions) {
    const target = firstTag(reaction, "e");
    if (!target) continue;
    const byEmoji = grouped.get(target) ?? new Map<string, ReactionSummary>();
    const summary = byEmoji.get(reaction.content) ?? {
      eventId: target,
      emoji: reaction.content,
      authors: [],
    };
    if (!summary.authors.includes(reaction.pubkey)) {
      summary.authors.push(reaction.pubkey);
    }
    byEmoji.set(reaction.content, summary);
    grouped.set(target, byEmoji);
  }
  return new Map(
    [...grouped.entries()].map(([eventId, summaries]) => [
      eventId,
      [...summaries.values()],
    ]),
  );
}

export function sendWorkspaceMessage(
  channelId: string,
  content: string,
  replyTo?: WorkspaceMessage,
  mentionPubkeys: string[] = [],
): Promise<NostrEvent> {
  const tags: string[][] = [["h", channelId]];
  if (replyTo) {
    const root = replyTo.rootEventId ?? replyTo.id;
    if (root === replyTo.id) tags.push(["e", root, "", "reply"]);
    else {
      tags.push(["e", root, "", "root"]);
      tags.push(["e", replyTo.id, "", "reply"]);
    }
  }
  for (const pubkey of [...new Set(mentionPubkeys)]) {
    tags.push(["p", pubkey]);
  }
  return publishEvent(relayWsUrl(), {
    kind: KIND_STREAM_MESSAGE,
    content: content.trim(),
    tags,
  });
}

export function createWorkspaceChannel(
  name: string,
  about: string,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: 9007,
    content: "",
    tags: [
      ["h", crypto.randomUUID()],
      ["name", name.trim().replace(/^#+/, "")],
      ["visibility", "open"],
      ["channel_type", "stream"],
      ...(about.trim() ? [["about", about.trim()]] : []),
    ],
  });
}

export function addWorkspaceMember(
  channelId: string,
  pubkey: string,
  role: "member" | "bot" = "member",
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: 9000,
    content: "",
    tags: [
      ["h", channelId],
      ["p", pubkey],
      ["role", role],
    ],
  });
}

export async function publishWorkspaceProfile(
  pubkey: string,
  displayName: string,
): Promise<NostrEvent> {
  const existingEvents = await queryEvents(relayWsUrl(), {
    kinds: [KIND_PROFILE],
    authors: [pubkey],
    limit: 20,
  });
  const existing = existingEvents.sort(
    (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
  )[0];
  let content: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing.content) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        content = parsed as Record<string, unknown>;
      }
    } catch {
      // Preserve the valid name fields below when the existing profile is malformed.
    }
  }
  const name = displayName.trim();
  return publishEvent(relayWsUrl(), {
    kind: KIND_PROFILE,
    content: JSON.stringify({
      ...content,
      display_name: name,
      name,
    }),
    tags: [],
  });
}

export function editWorkspaceMessage(
  message: WorkspaceMessage,
  content: string,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_STREAM_MESSAGE_EDIT,
    content: content.trim(),
    tags: [
      ["h", message.channelId],
      ["e", message.id],
    ],
  });
}

export function deleteWorkspaceMessage(
  message: WorkspaceMessage,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_DELETE,
    content: "",
    tags: [
      ["h", message.channelId],
      ["e", message.id],
    ],
  });
}

export function reactToWorkspaceMessage(
  message: WorkspaceMessage,
  emoji: string,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_REACTION,
    content: emoji,
    tags: [["e", message.id]],
  });
}

export function subscribeToChannel(
  channelId: string,
  onEvent: (message: WorkspaceMessage) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
): () => void {
  return subscribeEvents(
    relayWsUrl(),
    { kinds: MESSAGE_KINDS, "#h": [channelId] },
    (event) => onEvent(parseMessage(event)),
    onStatus,
  );
}

export function subscribeToChannels(
  channelIds: string[],
  onEvent: (message: WorkspaceMessage) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
): () => void {
  const unique = [...new Set(channelIds.filter(Boolean))];
  if (unique.length === 0) return () => {};
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: MESSAGE_KINDS,
      "#h": unique,
      since: Math.floor(Date.now() / 1000),
    },
    (event) => onEvent(parseMessage(event)),
    onStatus,
  );
}

export function subscribeToReactions(
  eventIds: string[],
  onEvent: (reaction: NostrEvent) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
): () => void {
  const unique = [...new Set(eventIds.filter(Boolean))].slice(0, 500);
  if (unique.length === 0) return () => {};
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_REACTION],
      "#e": unique,
      since: Math.floor(Date.now() / 1000),
    },
    onEvent,
    onStatus,
  );
}

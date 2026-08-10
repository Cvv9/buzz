import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  GENERAL_PROFILE_KINDS,
  hostedDirectoryEvents,
} from "./workspace-agent-directory-policy";
import { parseWorkspaceAgentModels } from "./workspace-agent-models";
import { canDiscoverPrivateWorkspaceChannels } from "./workspace-channel-discovery-policy";
import {
  buildHostedAgentConfigTemplate,
  hostedAgentConfigTarget as hostedAgentConfigTargetForEvent,
  HOSTED_AGENT_CONFIG_SCHEMA,
  isNewerReplaceableHead,
} from "./workspace-hosted-agent-config-policy";
import { listArchivedWorkspaceIdentities } from "./workspace-archive-api";
import {
  customEmojiFromReaction,
  isSafeEmojiImageUrl,
  normalizeEmojiShortcode,
  type CustomEmoji,
} from "@/features/custom-emoji/custom-emoji-policy";

export const KIND_PROFILE = 0;
export const KIND_DELETION = 5;
export const KIND_REACTION = 7;
export const KIND_STREAM_MESSAGE = 9;
export const KIND_AGENT_PROFILE = 10100;
export const KIND_COMMUNITY_MEMBERS = 13534;
export const KIND_ARCHIVED_IDENTITIES = 13535;
export const KIND_READ_STATE = 30078;
export const KIND_CHANNEL_METADATA = 39000;
export const KIND_CHANNEL_MEMBERS = 39002;
export const KIND_STREAM_MESSAGE_V2 = 40002;
export const KIND_STREAM_MESSAGE_EDIT = 40003;
export const KIND_SYSTEM_MESSAGE = 40099;
export const KIND_MANAGED_AGENT = 30177;
/** Public hosted-agent presentation configuration. Kind 30179 is private. */
export const KIND_HOSTED_AGENT_CONFIG = 30180;
export const KIND_MEMBER_ADDED_NOTIFICATION = 44100;
export const KIND_MEMBER_REMOVED_NOTIFICATION = 44101;
export const KIND_NIP29_DELETE = 9005;
export const KIND_NIP29_PUT_USER = 9000;
export const KIND_NIP29_REMOVE_USER = 9001;
export const KIND_NIP29_EDIT_METADATA = 9002;
export const KIND_NIP29_DELETE_GROUP = 9008;
export { HOSTED_AGENT_CONFIG_SCHEMA };
/** Event kinds that participate in a materialized workspace conversation. */
export const MESSAGE_KINDS = [
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
  /** Relay-backed, shared catalog section. Empty/unset is uncategorized. */
  catalogSection: string;
};

/** A partial NIP-29 metadata update. Omitted fields are intentionally preserved. */
export type WorkspaceChannelUpdate = {
  name?: string;
  about?: string;
  visibility?: "public" | "private";
  /** `null` clears the shared section. */
  catalogSection?: string | null;
};

export type WorkspaceChannelMember = {
  pubkey: string;
  role: "owner" | "admin" | "member" | "guest" | "bot";
};
export type WorkspaceCommunityMember = {
  pubkey: string;
  role: "owner" | "admin" | "member";
};

export type WorkspaceProfile = {
  pubkey: string;
  name: string;
  aliases?: string[];
  picture?: string;
  about?: string;
  isAgent?: boolean;
  audience?: "community" | "owner";
  ownerPubkey?: string;
  accessTier?: "shared" | "personal" | "admin";
  model?: string;
  models?: import("./workspace-agent-models").WorkspaceAgentModel[];
  resources?: string[];
};

export type WorkspaceMessage = NostrEvent & {
  channelId: string;
  rootEventId: string | null;
  parentEventId: string | null;
};

export type ReactionSummary = {
  /** The message that received this reaction. */
  eventId: string;
  emoji: string;
  emojiUrl?: string;
  authors: string[];
  /** The latest reaction event from each author, used for NIP-09 removal. */
  reactionEventIdsByAuthor: Record<string, string>;
};

function firstTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function allTags(event: NostrEvent, name: string): string[][] {
  return event.tags.filter((tag) => tag[0] === name);
}

function profileAliases(content: Record<string, unknown>): string[] {
  if (!Array.isArray(content.aliases)) return [];
  return content.aliases
    .filter((alias): alias is string => typeof alias === "string")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function dedupeReplaceable(events: NostrEvent[]): NostrEvent[] {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const key = `${event.kind}:${event.pubkey}:${firstTag(event, "d") ?? ""}`;
    const current = latest.get(key);
    if (isNewerReplaceableHead(event, current)) {
      latest.set(key, event);
    }
  }
  return [...latest.values()];
}

function parsedContent(event: NostrEvent): Record<string, unknown> {
  try {
    return JSON.parse(event.content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isHostedAgentConfigEvent(event: NostrEvent): boolean {
  return hostedAgentConfigTargetForEvent(event) !== null;
}

function hostedAgentConfigTarget(event: NostrEvent): string | null {
  return hostedAgentConfigTargetForEvent(event);
}

function communityAdminPubkeys(events: NostrEvent[]): Set<string> {
  const latest = [...events].sort(
    (left, right) =>
      right.created_at - left.created_at || left.id.localeCompare(right.id),
  )[0];
  if (!latest) return new Set();
  return new Set(
    latest.tags
      .filter(
        (tag) =>
          tag[0] === "member" &&
          (tag[2] === "owner" || tag[2] === "admin") &&
          typeof tag[1] === "string",
      )
      .map((tag) => tag[1].toLowerCase()),
  );
}

function applyHostedAgentConfigs(
  profiles: Map<string, WorkspaceProfile>,
  configEvents: NostrEvent[],
  adminPubkeys: ReadonlySet<string>,
) {
  const latestByTarget = new Map<string, NostrEvent>();
  for (const event of configEvents) {
    const target = hostedAgentConfigTarget(event);
    const profile = target ? profiles.get(target) : undefined;
    if (!target || !profile) continue;
    const author = event.pubkey.toLowerCase();
    if (
      !adminPubkeys.has(author) &&
      profile.ownerPubkey?.toLowerCase() !== author
    ) {
      continue;
    }
    const current = latestByTarget.get(target);
    if (isNewerReplaceableHead(event, current)) {
      latestByTarget.set(target, event);
    }
  }

  for (const [target, event] of latestByTarget) {
    const profile = profiles.get(target);
    if (!profile) continue;
    const content = parsedContent(event);
    const configuredName =
      typeof content.name === "string" ? content.name.trim() : "";
    const avatarUrl = content.avatar_url;
    const model = content.model;
    profiles.set(target, {
      ...profile,
      name: configuredName || profile.name,
      picture:
        typeof avatarUrl === "string"
          ? avatarUrl.trim() || undefined
          : avatarUrl === null
            ? undefined
            : profile.picture,
      model:
        typeof model === "string"
          ? model.trim() || undefined
          : model === null
            ? undefined
            : profile.model,
    });
  }
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

/** Project a signed relay event into its channel and thread coordinates. */
export function parseWorkspaceMessage(event: NostrEvent): WorkspaceMessage {
  return {
    ...event,
    channelId: firstTag(event, "h") ?? "",
    ...parseThread(event),
  };
}

export async function listWorkspaceChannels(
  pubkey: string,
): Promise<WorkspaceChannel[]> {
  const [membershipEvents, communityMembers] = await Promise.all([
    queryEvents(relayWsUrl(), {
      kinds: [KIND_CHANNEL_MEMBERS],
      "#p": [pubkey],
      limit: 500,
    }),
    listWorkspaceCommunityMembers(),
  ]);
  const memberships = dedupeReplaceable(membershipEvents);
  const canDiscoverPrivate = canDiscoverPrivateWorkspaceChannels(
    pubkey,
    communityMembers,
  );
  const channelIds = [
    ...new Set(
      memberships
        .map((event) => firstTag(event, "d"))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (channelIds.length === 0 && !canDiscoverPrivate) return [];
  const metadata = dedupeReplaceable(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_CHANNEL_METADATA],
      ...(canDiscoverPrivate ? {} : { "#d": channelIds }),
      limit: 500,
    }),
  );
  const discoveredChannelIds = metadata
    .map((event) => firstTag(event, "d"))
    .filter((value): value is string => Boolean(value));
  const projectedMemberships = canDiscoverPrivate
    ? dedupeReplaceable(
        await queryEvents(relayWsUrl(), {
          kinds: [KIND_CHANNEL_MEMBERS],
          "#d": discoveredChannelIds,
          limit: 500,
        }),
      )
    : memberships;
  const membershipByChannel = new Map(
    projectedMemberships.map((event) => [firstTag(event, "d"), event]),
  );
  return metadata
    .map((event): WorkspaceChannel | null => {
      const id = firstTag(event, "d");
      if (
        !id ||
        firstTag(event, "archived") === "true" ||
        event.tags.some((tag) => tag[0] === "hidden")
      ) {
        return null;
      }
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
        catalogSection: firstTag(event, "catalog_section") || "",
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
    .map(parseWorkspaceMessage)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

export async function listProfiles(
  pubkeys: string[],
): Promise<Map<string, WorkspaceProfile>> {
  const unique = [...new Set(pubkeys.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const events = dedupeReplaceable(
    await queryEvents(relayWsUrl(), {
      kinds: [...GENERAL_PROFILE_KINDS],
      authors: unique,
      limit: Math.min(500, unique.length),
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
      aliases: profileAliases(content),
      picture:
        typeof content.picture === "string"
          ? content.picture
          : typeof content.avatar_url === "string"
            ? content.avatar_url
            : existing?.picture,
      about:
        typeof content.about === "string" ? content.about : existing?.about,
      isAgent: existing?.isAgent || event.kind === KIND_AGENT_PROFILE,
    });
  }
  return profiles;
}

/** Read the signed relay community membership list for channel invite pickers. */
export async function listWorkspaceCommunityMembers(): Promise<
  WorkspaceCommunityMember[]
> {
  const events = dedupeReplaceable(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_COMMUNITY_MEMBERS],
      limit: 50,
    }),
  );
  const latest = events.sort(
    (left, right) =>
      right.created_at - left.created_at || left.id.localeCompare(right.id),
  )[0];
  if (!latest) return [];
  return latest.tags
    .filter(
      (tag) =>
        tag[0] === "member" &&
        typeof tag[1] === "string" &&
        (tag[2] === "owner" || tag[2] === "admin" || tag[2] === "member"),
    )
    .map((tag) => ({
      pubkey: tag[1].toLowerCase(),
      role: tag[2] as WorkspaceCommunityMember["role"],
    }));
}

/** Read a channel's current NIP-29 role projection, not a local member cache. */
export async function listWorkspaceChannelMembers(
  channelId: string,
): Promise<WorkspaceChannelMember[]> {
  const events = dedupeReplaceable(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_CHANNEL_MEMBERS],
      "#d": [channelId],
      limit: 20,
    }),
  );
  const event = events.sort(
    (left, right) =>
      right.created_at - left.created_at || left.id.localeCompare(right.id),
  )[0];
  if (!event) return [];
  return allTags(event, "p")
    .filter(
      (tag): tag is [string, string, ...string[]] => typeof tag[1] === "string",
    )
    .map((tag) => ({
      pubkey: tag[1].toLowerCase(),
      role: (["owner", "admin", "member", "guest", "bot"].includes(tag[3])
        ? tag[3]
        : ["owner", "admin", "member", "guest", "bot"].includes(tag[2])
          ? tag[2]
          : "member") as WorkspaceChannelMember["role"],
    }));
}

export async function listAgents(
  viewerPubkey: string,
): Promise<WorkspaceProfile[]> {
  const [agentEvents, configEvents, membershipEvents, archivedPubkeys] =
    await Promise.all([
      queryEvents(relayWsUrl(), {
        // Kind 30177 is a managed-agent projection, not a hosted directory
        // entry. Treating every projection as hosted produced the stale
        // Bumble/Fizz/Honey roster in web workspaces. The compatibility form
        // remains accepted only below as an authorized config overlay.
        kinds: [KIND_AGENT_PROFILE],
        limit: 200,
      }),
      queryEvents(relayWsUrl(), {
        kinds: [KIND_HOSTED_AGENT_CONFIG, KIND_MANAGED_AGENT],
        limit: 500,
      }),
      queryEvents(relayWsUrl(), {
        kinds: [KIND_COMMUNITY_MEMBERS],
        limit: 50,
      }),
      listArchivedWorkspaceIdentities(),
    ]);
  const events = hostedDirectoryEvents(agentEvents);
  const agentPubkeys = events.map((event) => event.pubkey);
  const profiles = await listProfiles(agentPubkeys);
  for (const event of events) {
    const pubkey = event.pubkey;
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
      aliases: profileAliases(content),
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
      model: typeof content.model === "string" ? content.model : undefined,
      models: parseWorkspaceAgentModels(content.models),
      resources: Array.isArray(content.resources)
        ? content.resources
            .filter(
              (resource): resource is string => typeof resource === "string",
            )
            .map((resource) => resource.trim())
            .filter(Boolean)
        : undefined,
    });
  }
  applyHostedAgentConfigs(
    profiles,
    configEvents.filter(isHostedAgentConfigEvent),
    communityAdminPubkeys(membershipEvents),
  );
  return [...profiles.values()]
    .filter(
      (profile) =>
        !archivedPubkeys.has(profile.pubkey.toLowerCase()) &&
        (profile.audience !== "owner" || profile.ownerPubkey === viewerPubkey),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
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
  for (const reaction of reactions.sort(
    (left, right) =>
      right.created_at - left.created_at || left.id.localeCompare(right.id),
  )) {
    const target = firstTag(reaction, "e");
    if (!target) continue;
    const customEmoji = customEmojiFromReaction(
      reaction.content,
      reaction.tags,
    );
    const byEmoji = grouped.get(target) ?? new Map<string, ReactionSummary>();
    const summary = byEmoji.get(reaction.content) ?? {
      eventId: target,
      emoji: reaction.content,
      ...(customEmoji ? { emojiUrl: customEmoji.url } : {}),
      authors: [],
      reactionEventIdsByAuthor: {},
    };
    if (!summary.authors.includes(reaction.pubkey)) {
      summary.authors.push(reaction.pubkey);
    }
    const existingReactionId =
      summary.reactionEventIdsByAuthor[reaction.pubkey];
    if (!existingReactionId || reaction.id > existingReactionId) {
      summary.reactionEventIdsByAuthor[reaction.pubkey] = reaction.id;
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
  mediaTags: string[][] = [],
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
  tags.push(...mediaTags);
  return publishEvent(relayWsUrl(), {
    kind: KIND_STREAM_MESSAGE,
    content: content.trim(),
    tags,
  });
}

/** Match the relay/desktop canonical channel-name normalization exactly. */
export function canonicalWorkspaceChannelName(name: string): string {
  return name.replace(/^[#\s]+/, "").trimEnd();
}

export function createWorkspaceChannel(
  name: string,
  about: string,
  options: {
    visibility?: "public" | "private";
    catalogSection?: string;
    type?: "stream" | "forum";
  } = {},
): Promise<NostrEvent> {
  const catalogSection = options.catalogSection?.trim();
  return publishEvent(relayWsUrl(), {
    kind: 9007,
    content: "",
    tags: [
      ["h", crypto.randomUUID()],
      ["name", canonicalWorkspaceChannelName(name)],
      ["visibility", options.visibility === "private" ? "private" : "open"],
      ["channel_type", options.type ?? "stream"],
      ...(about.trim() ? [["about", about.trim()]] : []),
      ...(catalogSection ? [["catalog_section", catalogSection]] : []),
    ],
  });
}

export function updateWorkspaceChannel(
  channelId: string,
  input: WorkspaceChannelUpdate,
): Promise<NostrEvent> {
  const tags: string[][] = [["h", channelId]];
  if (input.name !== undefined) {
    tags.push(["name", canonicalWorkspaceChannelName(input.name)]);
  }
  if (input.about !== undefined) tags.push(["about", input.about.trim()]);
  if (input.visibility !== undefined) {
    tags.push([
      "visibility",
      input.visibility === "private" ? "private" : "open",
    ]);
  }
  if (input.catalogSection !== undefined) {
    tags.push(["catalog_section", input.catalogSection?.trim() ?? ""]);
  }
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_EDIT_METADATA,
    content: "",
    tags,
  });
}

export function archiveWorkspaceChannel(
  channelId: string,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_EDIT_METADATA,
    content: "",
    tags: [
      ["h", channelId],
      ["archived", "true"],
    ],
  });
}

export function unarchiveWorkspaceChannel(
  channelId: string,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_EDIT_METADATA,
    content: "",
    tags: [
      ["h", channelId],
      ["archived", "false"],
    ],
  });
}

export function deleteWorkspaceChannel(channelId: string): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_DELETE_GROUP,
    content: "",
    tags: [["h", channelId]],
  });
}

export function addWorkspaceMember(
  channelId: string,
  pubkey: string,
  role: Exclude<WorkspaceChannelMember["role"], "owner"> = "member",
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_PUT_USER,
    content: "",
    tags: [
      ["h", channelId],
      ["p", pubkey],
      ["role", role],
    ],
  });
}

/** NIP-29 role changes use the same PUT_USER event as invitations. */
export const changeWorkspaceMemberRole = addWorkspaceMember;

export function removeWorkspaceMember(
  channelId: string,
  pubkey: string,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_REMOVE_USER,
    content: "",
    tags: [
      ["h", channelId],
      ["p", pubkey],
    ],
  });
}

export type { HostedAgentConfigInput } from "./workspace-hosted-agent-config-policy";

/** Build the canonical, public hosted-agent presentation configuration. */
export function hostedAgentConfigTemplate(
  input: import("./workspace-hosted-agent-config-policy").HostedAgentConfigInput,
): { kind: number; content: string; tags: string[][] } {
  return buildHostedAgentConfigTemplate(input);
}

/**
 * Publish an overlay for an existing hosted directory entry. The relay verifies
 * that the signer is a community admin or the agent's declared owner; this API
 * cannot create or manage a browser-local agent.
 */
export function publishHostedAgentConfig(
  input: import("./workspace-hosted-agent-config-policy").HostedAgentConfigInput,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), hostedAgentConfigTemplate(input));
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
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
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
  customEmoji?: CustomEmoji | null,
): Promise<NostrEvent> {
  const shortcode = customEmoji
    ? normalizeEmojiShortcode(customEmoji.shortcode)
    : null;
  const customEmojiTags =
    customEmoji &&
    shortcode &&
    emoji.trim().toLowerCase() === `:${shortcode}:` &&
    isSafeEmojiImageUrl(customEmoji.url)
      ? [["emoji", shortcode, customEmoji.url]]
      : [];
  return publishEvent(relayWsUrl(), {
    kind: KIND_REACTION,
    content: emoji,
    tags: [["e", message.id], ...customEmojiTags],
  });
}

/**
 * Remove the caller's reaction through NIP-09. If the client has not yet
 * received the reaction id (for example, an immediate second click), look it
 * up by the exact target, author, and emoji before publishing the deletion.
 */
export async function removeWorkspaceReaction(
  message: WorkspaceMessage,
  emoji: string,
  ownPubkey: string,
  knownReactionEventId?: string,
): Promise<NostrEvent | null> {
  let reactionEventId = knownReactionEventId;
  if (!reactionEventId) {
    const reactions = await queryEvents(relayWsUrl(), {
      kinds: [KIND_REACTION],
      authors: [ownPubkey],
      "#e": [message.id],
      limit: 50,
    });
    reactionEventId = reactions
      .filter((reaction) => reaction.content === emoji)
      .sort(
        (left, right) =>
          right.created_at - left.created_at || left.id.localeCompare(right.id),
      )[0]?.id;
  }
  if (!reactionEventId) return null;
  return publishEvent(relayWsUrl(), {
    kind: KIND_DELETION,
    content: "",
    tags: [["e", reactionEventId]],
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
    (event) => onEvent(parseWorkspaceMessage(event)),
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
    (event) => onEvent(parseWorkspaceMessage(event)),
    onStatus,
  );
}

/**
 * Live NIP-29 catalog heads. The relay permits this exclusive discovery filter
 * to cross its channel routing boundary, then rechecks open/private access for
 * every recipient before fan-out.
 */
export function subscribeToWorkspaceChannelCatalog(
  onEvent: (event: NostrEvent) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
): () => void {
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_CHANNEL_METADATA, KIND_CHANNEL_MEMBERS],
      since: Math.floor(Date.now() / 1000),
    },
    onEvent,
    onStatus,
  );
}

/** Live hosted-directory, authorized-overlay, and community-role updates. */
export function subscribeToWorkspaceDirectory(
  onEvent: (event: NostrEvent) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
): () => void {
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [
        KIND_AGENT_PROFILE,
        KIND_HOSTED_AGENT_CONFIG,
        KIND_MANAGED_AGENT,
        KIND_COMMUNITY_MEMBERS,
      ],
      since: Math.floor(Date.now() / 1000),
    },
    onEvent,
    onStatus,
  );
}

/** Receive the recipient-targeted join/leave signals for the current viewer. */
export function subscribeToWorkspaceMembershipChanges(
  viewerPubkey: string,
  onEvent: (event: NostrEvent) => void,
  onStatus?: Parameters<typeof subscribeEvents>[3],
): () => void {
  if (!viewerPubkey) return () => {};
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_MEMBER_ADDED_NOTIFICATION, KIND_MEMBER_REMOVED_NOTIFICATION],
      "#p": [viewerPubkey.toLowerCase()],
      since: Math.floor(Date.now() / 1000),
    },
    onEvent,
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

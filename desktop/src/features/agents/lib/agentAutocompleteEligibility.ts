import type { Channel, RelayAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export function resolveAgentMentionDisplayName({
  directoryName,
  memberName,
  profileDisplayName,
  profileHandle,
}: {
  directoryName?: string | null;
  memberName?: string | null;
  profileDisplayName?: string | null;
  profileHandle?: string | null;
}) {
  return (
    directoryName?.trim() ||
    memberName?.trim() ||
    profileDisplayName?.trim() ||
    profileHandle?.trim() ||
    null
  );
}

export function getSharedChannelIds(channels: readonly Channel[] | undefined) {
  return new Set(
    (channels ?? [])
      .filter((channel) => channel.isMember && channel.archivedAt === null)
      .map((channel) => channel.id),
  );
}

export function relayAgentIsSharedWithUser(
  agent: Pick<
    RelayAgent,
    | "accessTier"
    | "audience"
    | "channelIds"
    | "ownerPubkey"
    | "respondTo"
    | "respondToAllowlist"
  >,
  _sharedChannelIds: ReadonlySet<string>,
  currentPubkey?: string | null,
) {
  const normalizedCurrentPubkey = currentPubkey
    ? normalizePubkey(currentPubkey)
    : null;

  const normalizedOwnerPubkey = agent.ownerPubkey
    ? normalizePubkey(agent.ownerPubkey)
    : null;

  const isPrivateAgent =
    agent.audience === "owner" ||
    agent.accessTier === "personal" ||
    agent.accessTier === "admin";
  if (isPrivateAgent) {
    return Boolean(
      normalizedCurrentPubkey &&
        normalizedOwnerPubkey === normalizedCurrentPubkey,
    );
  }

  // An explicit allowlist is authoritative and outranks the hosted-directory
  // visibility below. A shared/community agent that names specific people must
  // stay hidden from everyone else, otherwise the allowlist means nothing —
  // and since the relay marks hosted agents community/shared by default, the
  // visibility check below would otherwise swallow every allowlist. Fails
  // closed when the viewer is unknown.
  if (agent.respondTo === "allowlist") {
    return Boolean(
      normalizedCurrentPubkey &&
        agent.respondToAllowlist
          .map((pubkey) => normalizePubkey(pubkey))
          .includes(normalizedCurrentPubkey),
    );
  }

  // Access tier and audience are the authoritative visibility controls for
  // the hosted directory. Community agents must be discoverable before their
  // first channel invitation; older runtime records can still carry a stale
  // owner-only response policy after an agent was promoted to shared.
  if (agent.audience === "community" || agent.accessTier === "shared") {
    return true;
  }

  // The relay defaults a missing respond_to value to owner-only. Hosted
  // personal/admin agents are still invocable by their owner even when they
  // are not members of the channel being composed in.
  if (
    normalizedCurrentPubkey &&
    normalizedOwnerPubkey === normalizedCurrentPubkey &&
    (agent.respondTo === null || agent.respondTo === "owner-only")
  ) {
    return true;
  }

  // Community agents explicitly configured for anyone are invocable across
  // the community, even before they belong to the channel being composed in.
  // An owner/admin mention adds the agent to that channel during the send
  // flow. Requiring an existing shared channel here made the directory entry
  // disappear precisely when that first invitation was needed.
  return agent.respondTo === "anyone";
}

export function relayAgentCanRespondInChannel(
  agent: Pick<
    RelayAgent,
    "channelIds" | "ownerPubkey" | "respondTo" | "respondToAllowlist"
  >,
  channelId: string,
  currentPubkey?: string | null,
) {
  return (
    agent.channelIds.includes(channelId) &&
    relayAgentIsSharedWithUser(agent, new Set([channelId]), currentPubkey)
  );
}

export type AgentEligibilityScope =
  | { type: "community" }
  | { type: "channel"; channelId: string }
  | { type: "managed-only" };

export function getMentionableAgentPubkeys({
  currentPubkey,
  eligibilityScope,
  managedAgentPubkeys,
  relayAgents,
  sharedChannelIds,
}: {
  currentPubkey?: string | null;
  eligibilityScope: AgentEligibilityScope;
  managedAgentPubkeys: Iterable<string>;
  relayAgents: readonly RelayAgent[] | undefined;
  sharedChannelIds: ReadonlySet<string>;
}) {
  const pubkeys = new Set(
    [...managedAgentPubkeys].map((pubkey) => normalizePubkey(pubkey)),
  );

  for (const agent of relayAgents ?? []) {
    const isAllowed =
      eligibilityScope.type === "managed-only"
        ? false
        : eligibilityScope.type === "community"
          ? relayAgentIsSharedWithUser(agent, sharedChannelIds, currentPubkey)
          : relayAgentCanRespondInChannel(
              agent,
              eligibilityScope.channelId,
              currentPubkey,
            );
    if (isAllowed) {
      pubkeys.add(normalizePubkey(agent.pubkey));
    }
  }

  return pubkeys;
}

// Hosted VarVik agents are pre-registered in the relay directory rather than
// discovered as managed processes, so an identity is eligible when it appears
// in either directory.
export function isAgentIdentityInKnownDirectories(
  candidate: { isAgent?: boolean; pubkey: string },
  managedAgentPubkeys: ReadonlySet<string>,
  relayAgentPubkeys: ReadonlySet<string> = new Set(),
) {
  const pubkey = normalizePubkey(candidate.pubkey);
  return (
    candidate.isAgent !== true ||
    managedAgentPubkeys.has(pubkey) ||
    relayAgentPubkeys.has(pubkey)
  );
}

export type AgentMentionAdmission = "allow" | "deny" | "unknown";

export function getAgentMentionAdmission({
  isAgent,
  isManagedAgent,
  pubkey,
  ownerPubkey,
  currentPubkey,
  mentionableAgentPubkeys,
  directoryReady,
  ownerOnly,
}: {
  isAgent: boolean;
  isManagedAgent: boolean;
  pubkey: string;
  ownerPubkey?: string | null;
  currentPubkey?: string | null;
  mentionableAgentPubkeys: ReadonlySet<string>;
  directoryReady: boolean;
  ownerOnly: boolean | undefined;
}): AgentMentionAdmission {
  if (!isAgent) return "allow";
  if (!directoryReady || ownerOnly === undefined) return "unknown";

  const normalized = normalizePubkey(pubkey);
  if (!mentionableAgentPubkeys.has(normalized)) return "deny";
  if (!ownerOnly || isManagedAgent) return "allow";
  if (!ownerPubkey || !currentPubkey) return "unknown";

  return normalizePubkey(ownerPubkey) === normalizePubkey(currentPubkey)
    ? "allow"
    : "deny";
}

export function shouldHideAgentFromMentions({
  isAgent,
  isManagedAgent = false,
  pubkey,
  ownerPubkey,
  currentPubkey,
  mentionableAgentPubkeys,
  directoryReady = true,
  ownerOnly,
}: {
  isAgent: boolean;
  isManagedAgent?: boolean;
  pubkey: string;
  ownerPubkey?: string | null;
  currentPubkey?: string | null;
  mentionableAgentPubkeys: ReadonlySet<string>;
  directoryReady?: boolean;
  ownerOnly: boolean | undefined;
}) {
  return (
    getAgentMentionAdmission({
      isAgent,
      isManagedAgent,
      pubkey,
      ownerPubkey,
      currentPubkey,
      mentionableAgentPubkeys,
      directoryReady,
      ownerOnly,
    }) !== "allow"
  );
}

export function getAgentIdentityPubkeys({
  managedAgentPubkeys,
  relayAgents,
  members,
  profileIsAgent,
}: {
  managedAgentPubkeys: ReadonlySet<string>;
  relayAgents: readonly { pubkey: string }[];
  members: readonly {
    pubkey: string;
    isAgent?: boolean;
    role?: string | null;
  }[];
  profileIsAgent: (pubkey: string) => boolean;
}) {
  return new Set([
    ...managedAgentPubkeys,
    ...relayAgents.map(({ pubkey }) => normalizePubkey(pubkey)),
    ...members
      .filter(
        (member) =>
          member.isAgent === true ||
          member.role === "bot" ||
          profileIsAgent(normalizePubkey(member.pubkey)),
      )
      .map(({ pubkey }) => normalizePubkey(pubkey)),
  ]);
}

export function getAdmittedAgentPubkeys(
  candidates: readonly { pubkey?: string; isAgent?: boolean }[],
) {
  return new Set(
    candidates.flatMap((candidate) =>
      candidate.isAgent && candidate.pubkey
        ? [normalizePubkey(candidate.pubkey)]
        : [],
    ),
  );
}

export function rememberSelectedAgentPubkeys(
  target: Set<string>,
  selected: readonly { pubkey?: string; isAgent?: boolean }[],
  selectionIsAgent: boolean,
) {
  for (const candidate of selected) {
    if (candidate.pubkey && (selectionIsAgent || candidate.isAgent === true)) {
      target.add(normalizePubkey(candidate.pubkey));
    }
  }
}

export function filterAdmittedMentionPubkeys(
  pubkeys: readonly string[],
  agentIdentityPubkeys: ReadonlySet<string>,
  admittedAgentPubkeys: ReadonlySet<string>,
) {
  return pubkeys.filter((pubkey) => {
    const normalized = normalizePubkey(pubkey);
    return (
      !agentIdentityPubkeys.has(normalized) ||
      admittedAgentPubkeys.has(normalized)
    );
  });
}

export function isAgentMentionChannelType(type?: string | null) {
  return type === "stream" || type === "forum";
}

export function uniqueAutocompleteLabels(
  candidates: readonly AgentAutocompleteCandidate[],
) {
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    for (const label of [
      candidate.displayName,
      candidate.personaName,
      candidate.secondaryLabel,
    ]) {
      const trimmed = label?.trim();
      if (trimmed && !unique.has(trimmed.toLowerCase())) {
        unique.set(trimmed.toLowerCase(), trimmed);
      }
    }
  }
  return [...unique.values()];
}

export function filterCachedAgentSuggestions<
  T extends {
    isAgent?: boolean;
    pubkey?: string;
  },
>(
  suggestions: readonly T[],
  currentCandidates: readonly AgentAutocompleteCandidate[],
) {
  const admittedAgentPubkeys = new Set(
    currentCandidates.flatMap((candidate) =>
      candidate.isAgent && candidate.pubkey
        ? [normalizePubkey(candidate.pubkey)]
        : [],
    ),
  );
  return suggestions.filter(
    (suggestion) =>
      !suggestion.isAgent ||
      !suggestion.pubkey ||
      admittedAgentPubkeys.has(normalizePubkey(suggestion.pubkey)),
  );
}

type AgentAutocompleteCandidate = {
  pubkey?: string;
  displayName?: string | null;
  personaName?: string | null;
  secondaryLabel?: string | null;
  ownerPubkey?: string | null;
  isAgent?: boolean;
  isManagedAgent?: boolean;
  isMember?: boolean;
  personaId?: string | null;
};

function agentIdentityKey<T extends AgentAutocompleteCandidate>(candidate: T) {
  if (candidate.isAgent !== true || !candidate.pubkey) {
    return null;
  }

  // Pubkeys—not persona metadata or a display name—are agent identities.
  // A persona may be installed more than once, and an owner may intentionally
  // create multiple same-named agents. Collapsing either case makes one agent
  // impossible to choose from autocomplete.
  return `pubkey:${normalizePubkey(candidate.pubkey)}`;
}

function agentCandidateRank<T extends AgentAutocompleteCandidate>(
  candidate: T,
  preferredPubkeys: ReadonlySet<string>,
) {
  const pubkey = candidate.pubkey ? normalizePubkey(candidate.pubkey) : null;

  return [
    candidate.isMember === true ? 0 : 1,
    pubkey && preferredPubkeys.has(pubkey) ? 0 : 1,
    candidate.isManagedAgent === true ? 0 : 1,
    candidate.personaId ? 0 : 1,
  ];
}

function isPreferredAgentCandidate<T extends AgentAutocompleteCandidate>(
  next: T,
  current: T,
  preferredPubkeys: ReadonlySet<string>,
) {
  const nextRank = agentCandidateRank(next, preferredPubkeys);
  const currentRank = agentCandidateRank(current, preferredPubkeys);

  for (let index = 0; index < nextRank.length; index++) {
    if (nextRank[index] !== currentRank[index]) {
      return nextRank[index] < currentRank[index];
    }
  }

  return false;
}

export function coalesceAutocompleteCandidatesByKey<T>(
  candidates: readonly T[],
  getKey: (candidate: T) => string | null,
) {
  const output: T[] = [];
  const indexesByKey = new Map<string, number>();

  for (const candidate of candidates) {
    const key = getKey(candidate);
    if (!key) {
      output.push(candidate);
      continue;
    }

    if (!indexesByKey.has(key)) {
      indexesByKey.set(key, output.length);
      output.push(candidate);
    }
  }

  return output;
}

export function coalesceAgentAutocompleteCandidates<
  T extends AgentAutocompleteCandidate,
>(
  candidates: readonly T[],
  {
    currentPubkey: _currentPubkey,
    getLabel: _getLabel,
    preferredPubkeys = new Set(),
  }: {
    currentPubkey?: string | null;
    getLabel: (candidate: T) => string | null | undefined;
    preferredPubkeys?: ReadonlySet<string>;
  },
) {
  const output: T[] = [];
  const indexesByKey = new Map<string, number>();

  for (const candidate of candidates) {
    const key = agentIdentityKey(candidate);
    if (!key) {
      output.push(candidate);
      continue;
    }

    const currentIndex = indexesByKey.get(key);
    if (currentIndex === undefined) {
      indexesByKey.set(key, output.length);
      output.push(candidate);
      continue;
    }

    if (
      isPreferredAgentCandidate(
        candidate,
        output[currentIndex],
        preferredPubkeys,
      )
    ) {
      output[currentIndex] = candidate;
    }
  }

  return output;
}

import type { RelayAgent, UserProfileSummary } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

type ProfileFallback = {
  avatarUrl: string | null;
  displayName: string | null;
};

function firstNonBlank(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * The signed agent directory (kind:10100) defines a hosted agent's current
 * presentation. A kind:0 profile is only a compatibility fallback: hosted
 * fleets can be renamed or rebranded without first rewriting old profiles.
 */
export function getHostedAgentPresentation(
  agent: Pick<RelayAgent, "name" | "avatarUrl">,
  profile?: ProfileFallback,
): { avatarUrl: string | null; displayName: string } {
  return {
    avatarUrl: firstNonBlank(agent.avatarUrl, profile?.avatarUrl),
    displayName:
      firstNonBlank(agent.name, profile?.displayName) ?? "Hosted agent",
  };
}

/**
 * Overlays current hosted-directory presentation onto historical kind:0
 * profiles. Inbox and message history keep the event author's pubkey, so a
 * renamed/rebranded agent should immediately render with its current identity.
 */
export function overlayHostedAgentProfiles(
  profiles: Record<string, UserProfileSummary> | undefined,
  agents: readonly RelayAgent[],
): Record<string, UserProfileSummary> | undefined {
  if (agents.length === 0) return profiles;

  const overlaid = { ...(profiles ?? {}) };
  for (const agent of agents) {
    const pubkey = normalizePubkey(agent.pubkey);
    const existing = overlaid[pubkey];
    const presentation = getHostedAgentPresentation(agent, existing);
    overlaid[pubkey] = {
      ...existing,
      avatarUrl: presentation.avatarUrl,
      displayName: presentation.displayName,
      isAgent: true,
      ownerPubkey: agent.ownerPubkey ?? existing?.ownerPubkey ?? null,
      nip05Handle: existing?.nip05Handle ?? null,
    };
  }

  return overlaid;
}

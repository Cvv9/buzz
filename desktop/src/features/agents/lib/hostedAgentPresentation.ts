import type { RelayAgent } from "@/shared/api/types";

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

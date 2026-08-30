import type {
  AgentReasoningEffort,
  RelayAgent,
  UserProfileSummary,
} from "@/shared/api/types";
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
 * Resolve the runtime summary shown by desktop compatibility surfaces.
 * Controller-managed values come only from the exact agent-signed runtime
 * acknowledgment. The old flat model field is display-only fallback data.
 */
export function getHostedAgentRuntimePresentation(
  agent: Pick<RelayAgent, "model" | "models" | "modelFamilies" | "runtime">,
): {
  effort: AgentReasoningEffort | null;
  managedOnWeb: boolean;
  modelId: string | null;
  modelName: string | null;
  revision: number | null;
} {
  const runtime = agent.runtime ?? null;
  const modelId = firstNonBlank(runtime?.model, agent.model);
  const modelName =
    agent.modelFamilies?.find((family) => family.id === modelId)?.name ??
    agent.models?.find((model) => model.id === modelId)?.name ??
    modelId;
  return {
    effort: runtime?.effort ?? null,
    managedOnWeb: runtime !== null,
    modelId,
    modelName,
    revision: runtime?.revision ?? null,
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

import { useAgentObserverIngestion } from "@/features/agents/useAgentObserverIngestion";
import { useAgentsDataRefresh } from "@/features/agents/lib/useAgentsDataRefresh";
import { useAutoRestartPolicy } from "@/features/agents/lib/useAutoRestartPolicy";
import { usePersonaSync } from "@/features/agents/lib/usePersonaSync";

/** Keep app-wide agent sync, refresh, and runtime observers mounted together. */
export function useAppShellAgentLifecycle(
  currentPubkey?: string,
  relayUrl?: string,
) {
  usePersonaSync(currentPubkey, relayUrl);
  useAgentsDataRefresh();
  useAutoRestartPolicy(relayUrl);

  // Observer ingestion is intentionally not identity-gated: managed agents
  // are covered during startup, then relay agents join once identity resolves.
  useAgentObserverIngestion();
}

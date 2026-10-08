import { truncatePubkey } from "../../shared/lib/pubkey.ts";
import type { WorkspaceProfile } from "./workspace-api";

/**
 * Direct-message pickers look names up by pubkey. Human names come from kind 0
 * profiles; hosted agents publish their names through the agent directory
 * (kinds 10100/30180) instead, so overlay the directory on top of the plain
 * profile map. A directory entry wins only where the plain map has nothing
 * better than a truncated pubkey.
 */
export function mergeDmRecipientProfiles(
  profiles: Map<string, WorkspaceProfile> | undefined,
  agents: readonly WorkspaceProfile[] | undefined,
): Map<string, WorkspaceProfile> {
  const merged = new Map(profiles ?? []);
  for (const agent of agents ?? []) {
    const key = agent.pubkey.toLowerCase();
    const existing = merged.get(key) ?? merged.get(agent.pubkey);
    if (!existing || existing.name === truncatePubkey(existing.pubkey)) {
      merged.set(key, { ...existing, ...agent, isAgent: true });
    }
  }
  return merged;
}

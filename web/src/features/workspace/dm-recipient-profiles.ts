import { truncatePubkey } from "../../shared/lib/pubkey.ts";
import type { WorkspaceProfile } from "./workspace-api";

/**
 * Direct-message pickers look names up by pubkey. Human names come from kind 0
 * profiles; hosted agents publish their names through the agent directory
 * (kinds 10100/30180) instead, so overlay the directory on top of the plain
 * profile map. The resolved hosted name/avatar take precedence; kind 0 is
 * fallback presentation only when the directory lacks that field.
 */
export function mergeDmRecipientProfiles(
  profiles: Map<string, WorkspaceProfile> | undefined,
  agents: readonly WorkspaceProfile[] | undefined,
): Map<string, WorkspaceProfile> {
  const merged = new Map(profiles ?? []);
  for (const agent of agents ?? []) {
    const key = agent.pubkey.toLowerCase();
    const existing = merged.get(key) ?? merged.get(agent.pubkey);
    const hasDirectoryName =
      agent.name.trim() !== "" && agent.name !== truncatePubkey(agent.pubkey);
    merged.set(key, {
      ...existing,
      ...agent,
      name: hasDirectoryName ? agent.name : (existing?.name ?? agent.name),
      picture: agent.picture || existing?.picture,
      isAgent: true,
    });
  }
  return merged;
}

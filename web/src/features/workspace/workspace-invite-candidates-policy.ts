import type {
  WorkspaceCommunityMember,
  WorkspaceProfile,
} from "./workspace-api";

/**
 * Split channel-invite candidates into humans and agents so the invite picker
 * can present them under distinct `<optgroup>`s instead of one flat list.
 *
 * A candidate is an agent when its pubkey matches one of the known agent
 * profiles (case-insensitive). Relative order within each group is preserved.
 */
export function partitionWorkspaceInviteCandidates(
  candidates: readonly WorkspaceCommunityMember[],
  agents: readonly WorkspaceProfile[],
): { members: WorkspaceCommunityMember[]; agents: WorkspaceCommunityMember[] } {
  const agentPubkeys = new Set(
    agents.map((agent) => agent.pubkey.toLowerCase()),
  );
  const members: WorkspaceCommunityMember[] = [];
  const agentMembers: WorkspaceCommunityMember[] = [];
  for (const candidate of candidates) {
    if (agentPubkeys.has(candidate.pubkey.toLowerCase())) {
      agentMembers.push(candidate);
    } else {
      members.push(candidate);
    }
  }
  return { members, agents: agentMembers };
}

/**
 * Default channel role for a freshly selected invite candidate: agents join as
 * `bot`, humans as `member`. The picker still lets a manager override it.
 */
export function defaultInviteRoleForCandidate(
  pubkey: string,
  agents: readonly WorkspaceProfile[],
): "member" | "bot" {
  const isAgent = agents.some(
    (agent) => agent.pubkey.toLowerCase() === pubkey.toLowerCase(),
  );
  return isAgent ? "bot" : "member";
}

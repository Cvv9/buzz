import type {
  WorkspaceChannelMember,
  WorkspaceCommunityMember,
} from "./workspace-api";

/** Deduplicate relay projections and omit people who already belong to a channel. */
export function availableWorkspaceInvitees(
  communityMembers: readonly WorkspaceCommunityMember[],
  channelMembers: readonly WorkspaceChannelMember[],
): WorkspaceCommunityMember[] {
  const existing = new Set(
    channelMembers.map((member) => member.pubkey.trim().toLowerCase()),
  );
  const candidates = new Map<string, WorkspaceCommunityMember>();
  for (const member of communityMembers) {
    const pubkey = member.pubkey.trim().toLowerCase();
    if (!pubkey || existing.has(pubkey) || candidates.has(pubkey)) continue;
    candidates.set(pubkey, { ...member, pubkey });
  }
  return [...candidates.values()].sort((left, right) =>
    left.pubkey.localeCompare(right.pubkey),
  );
}

/** A channel owner cannot be removed through the ordinary membership control. */
export function canRemoveWorkspaceChannelMember({
  member,
  canManage,
  viewerPubkey,
}: {
  member: WorkspaceChannelMember;
  canManage: boolean;
  viewerPubkey: string;
}): boolean {
  if (member.role === "owner") return false;
  return canManage || member.pubkey === viewerPubkey.trim().toLowerCase();
}

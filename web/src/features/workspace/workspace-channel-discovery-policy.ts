import type { WorkspaceCommunityMember } from "./workspace-api";

/** Only relay community owners/admins may use the private catalog recovery path. */
export function canDiscoverPrivateWorkspaceChannels(
  pubkey: string,
  members: WorkspaceCommunityMember[],
): boolean {
  const viewer = pubkey.toLowerCase();
  return members.some(
    (member) =>
      member.pubkey === viewer &&
      (member.role === "owner" || member.role === "admin"),
  );
}

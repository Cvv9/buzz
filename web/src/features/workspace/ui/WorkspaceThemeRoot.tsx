import { CommunityThemeController } from "@/shared/theme/CommunityThemeController";
import { shouldMountWorkspaceTheme } from "../workspace-theme-mount-policy";
import { useWorkspaceIdentity } from "../useWorkspaceIdentity";

/** Keeps identity-scoped appearance sync alive while browser routes change. */
export function WorkspaceThemeRoot() {
  const { identity } = useWorkspaceIdentity();
  return shouldMountWorkspaceTheme(identity?.pubkey) ? (
    <CommunityThemeController pubkey={identity.pubkey} />
  ) : null;
}

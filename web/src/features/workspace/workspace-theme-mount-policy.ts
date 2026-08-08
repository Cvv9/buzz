/**
 * Community appearance belongs to the authenticated workspace, not to a
 * populated channel list. Keep this decision independent of loading/empty
 * states so first-run users receive their saved theme before joining a channel.
 */
export function shouldMountWorkspaceTheme(
  authenticatedPubkey: string | null | undefined,
): authenticatedPubkey is string {
  return (
    typeof authenticatedPubkey === "string" && authenticatedPubkey.length > 0
  );
}

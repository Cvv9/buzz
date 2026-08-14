/**
 * Decide which channel should be active given the currently loaded channels.
 *
 * Callers MUST only invoke this once the channel catalog has finished loading
 * (e.g. `channelsQuery.isSuccess`). During progressive boot the visible-channel
 * list is incomplete, and applying the first-channel fallback then would clobber
 * a validly stored selection whose channel simply had not arrived yet.
 *
 * - Keeps the current selection when it is present among the loaded channels
 *   (this is how a stored `buzz.web.active-channel` id is restored on boot).
 * - Otherwise falls back to the first visible channel, or `null` when none.
 */
export function resolveActiveChannelId({
  activeChannelId,
  visibleChannelIds,
}: {
  activeChannelId: string | null;
  visibleChannelIds: readonly string[];
}): string | null {
  if (activeChannelId && visibleChannelIds.includes(activeChannelId)) {
    return activeChannelId;
  }
  return visibleChannelIds[0] ?? null;
}

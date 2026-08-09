type DirectoryEvent = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
};

/**
 * The hosted roster is a kind:10100 directory, never a grab bag of managed
 * kind:30177 projections. The latter are local/persona projections and may
 * describe agents that are intentionally not shared with this community.
 */
export function hostedDirectoryEvents<T extends DirectoryEvent>(
  events: T[],
): T[] {
  const latest = new Map<string, T>();
  for (const event of events) {
    if (event.kind !== 10100) continue;
    const current = latest.get(event.pubkey);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      latest.set(event.pubkey, event);
    }
  }
  return [...latest.values()];
}

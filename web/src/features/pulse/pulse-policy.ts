export const PULSE_READABLE_KINDS = [9, 40002, 45001, 45003] as const;

export type PulseEvent = {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
};

export type AgentPulseGroup = {
  pubkey: string;
  events: PulseEvent[];
  latestAt: number;
  earliestAt: number;
};

function tagValue(event: PulseEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

export function pulseChannelId(event: PulseEvent): string | null {
  return tagValue(event, "h")?.trim() || null;
}

/** NIP-10 reply target, preferring an explicit reply marker over legacy tags. */
export function pulseReplyParent(event: PulseEvent): string | null {
  const references = event.tags.filter((tag) => tag[0] === "e" && tag[1]);
  return (
    references.find((tag) => tag[3] === "reply")?.[1] ??
    references.find((tag) => tag[3] === "root")?.[1] ??
    references[references.length - 1]?.[1] ??
    null
  );
}

/** Project issue/PR comments do not belong in Pulse's social activity feed. */
export function isProjectComment(event: PulseEvent): boolean {
  return event.tags.some(
    (tag) => tag[0] === "a" && (tag[1]?.startsWith("30617:") ?? false),
  );
}

/**
 * Keep Pulse bounded to explicit channel content the viewer has already been
 * allowed to discover. Private observer frames are deliberately absent here.
 */
export function projectPulseEvents(
  events: readonly PulseEvent[],
  readableChannelIds: readonly string[],
): PulseEvent[] {
  const channels = new Set(readableChannelIds.map((id) => id.toLowerCase()));
  const byId = new Map<string, PulseEvent>();
  for (const event of events) {
    if (
      !PULSE_READABLE_KINDS.includes(event.kind as 9 | 40002 | 45001 | 45003)
    ) {
      continue;
    }
    const channelId = pulseChannelId(event);
    if (!channelId || !channels.has(channelId.toLowerCase())) continue;
    if (isProjectComment(event)) continue;
    byId.set(event.id, event);
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
}

/** Port of desktop's consecutive agent note grouping, over browser-safe events. */
export function groupAgentPulseEvents(
  events: readonly PulseEvent[],
  agentPubkeys: ReadonlySet<string>,
  windowSeconds = 300,
): AgentPulseGroup[] {
  const groups: AgentPulseGroup[] = [];
  let current: AgentPulseGroup | null = null;
  for (const event of events) {
    if (!agentPubkeys.has(event.pubkey.toLowerCase())) continue;
    const previous = current?.events[current.events.length - 1];
    if (
      current &&
      previous &&
      current.pubkey === event.pubkey &&
      previous.created_at - event.created_at <= windowSeconds
    ) {
      current.events.push(event);
      current.earliestAt = event.created_at;
      continue;
    }
    if (current) groups.push(current);
    current = {
      pubkey: event.pubkey,
      events: [event],
      latestAt: event.created_at,
      earliestAt: event.created_at,
    };
  }
  if (current) groups.push(current);
  return groups;
}

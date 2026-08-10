import type { WorkspaceChannel } from "./workspace-api";

export type WorkspaceAgentChannelGroup = {
  label: string;
  channels: WorkspaceChannel[];
};

const OTHER_CHANNELS = "Other channels";

/**
 * Keep a large hosted-agent access list scannable without creating a second
 * channel catalog. The relay-backed catalog section remains the only grouping
 * source, while a local search merely filters the visible management list.
 */
export function groupWorkspaceAgentChannels(
  channels: readonly WorkspaceChannel[],
  search: string,
): WorkspaceAgentChannelGroup[] {
  const query = search.trim().toLocaleLowerCase();
  const groups = new Map<string, WorkspaceChannel[]>();

  for (const channel of channels) {
    const section = channel.catalogSection.trim() || OTHER_CHANNELS;
    const searchable =
      `${channel.name}\n${channel.about}\n${section}`.toLocaleLowerCase();
    if (query && !searchable.includes(query)) continue;
    const entries = groups.get(section) ?? [];
    entries.push(channel);
    groups.set(section, entries);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === OTHER_CHANNELS) return 1;
      if (right === OTHER_CHANNELS) return -1;
      return left.localeCompare(right);
    })
    .map(([label, entries]) => ({
      label,
      channels: [...entries].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    }));
}

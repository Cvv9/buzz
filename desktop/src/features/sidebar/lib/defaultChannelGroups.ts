import type { Channel } from "@/shared/api/types";

// Keep this list aligned with the VarVik workspace grouping used by the web
// client. The relay does not currently expose a first-class project category,
// so both clients derive the default section from the stable channel name.
export const PROJECT_CHANNEL_NAMES = new Set([
  "aaral-pms",
  "ashrayu-media",
  "atelier-crm",
  "bidwave",
  "factoryos",
  "fzine",
  "hrr-capital",
  "nuve",
  "project-dukaan",
  "renderboard",
  "sylars-control",
  "ummidvar",
  "vakeelos",
  "varvik-suite",
  "varvik-website",
  "zup-coffee",
]);

export function isProjectChannel(channel: Pick<Channel, "name">): boolean {
  const name = channel.name.toLowerCase();
  return PROJECT_CHANNEL_NAMES.has(name) || name.startsWith("project-");
}

export function partitionDefaultChannelGroups(channels: Channel[]): {
  workspace: Channel[];
  projects: Channel[];
} {
  const workspace: Channel[] = [];
  const projects: Channel[] = [];

  for (const channel of channels) {
    (isProjectChannel(channel) ? projects : workspace).push(channel);
  }

  return { workspace, projects };
}

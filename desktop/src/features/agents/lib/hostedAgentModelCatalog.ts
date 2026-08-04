import type { AgentModelInfo } from "@/shared/api/types";

export type HostedAgentModelGroup = {
  id: string;
  label: string;
  options: AgentModelInfo[];
};

const FALLBACK_GROUPS: readonly HostedAgentModelGroup[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    options: [
      { id: "claude-opus-4-6", name: "Opus", description: null },
      { id: "claude-fable-5", name: "Fable", description: null },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    options: [
      { id: "gpt-5.6-sol", name: "Sol", description: null },
      { id: "gpt-5.6-luna", name: "Luna", description: null },
      { id: "gpt-5.6-terra", name: "Terra", description: null },
    ],
  },
];

function providerGroupId(model: AgentModelInfo): string {
  const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase();
  if (/claude|opus|sonnet|haiku|fable/.test(haystack)) return "claude-code";
  if (/codex|gpt|sol|luna|terra/.test(haystack)) return "codex";
  return "agent-reported";
}

/**
 * Merge the hosted runtime's live ACP model catalog with Buzz's provider
 * choices. Live metadata wins on labels; the fallback keeps the editor useful
 * while older hosted containers are being rolled forward.
 */
export function hostedAgentModelGroups(
  advertised: readonly AgentModelInfo[] | null | undefined,
): HostedAgentModelGroup[] {
  const groups = FALLBACK_GROUPS.map((group) => ({
    ...group,
    options: group.options.map((option) => ({ ...option })),
  }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set(
    groups.flatMap((group) => group.options.map((option) => option.id)),
  );

  for (const model of advertised ?? []) {
    const id = model.id.trim();
    if (!id) continue;
    const groupId = providerGroupId(model);
    let group = byId.get(groupId);
    if (!group) {
      group = { id: groupId, label: "Agent-reported models", options: [] };
      groups.push(group);
      byId.set(groupId, group);
    }

    const existing = groups
      .flatMap((candidate) => candidate.options)
      .find((option) => option.id === id);
    if (existing) {
      existing.name = model.name?.trim() || existing.name;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    group.options.push({
      id,
      name: model.name?.trim() || id,
      description: model.description,
    });
  }

  return groups.filter((group) => group.options.length > 0);
}

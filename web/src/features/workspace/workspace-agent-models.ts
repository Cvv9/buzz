export type WorkspaceAgentModel = { id: string; name?: string };

export const WORKSPACE_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type WorkspaceReasoningEffort =
  (typeof WORKSPACE_REASONING_EFFORTS)[number];

export type WorkspaceAgentModelFamily = {
  id: string;
  name: string;
  description: string;
  defaultEffort: WorkspaceReasoningEffort;
  efforts: WorkspaceReasoningEffort[];
};

const MODEL_ID = /^[a-z0-9][a-z0-9._/-]{0,127}$/;

export function isWorkspaceReasoningEffort(
  value: unknown,
): value is WorkspaceReasoningEffort {
  return (
    typeof value === "string" &&
    (WORKSPACE_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

/** Parse the bounded capability catalog published by a live ACP adapter. */
export function parseWorkspaceAgentModels(
  value: unknown,
): WorkspaceAgentModel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const models = new Map<string, WorkspaceAgentModel>();
  for (const entry of value.slice(0, 100)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || !candidate.id.trim()) continue;
    const id = candidate.id.trim();
    if (models.has(id)) continue;
    models.set(id, {
      id,
      ...(typeof candidate.name === "string" && candidate.name.trim()
        ? { name: candidate.name.trim() }
        : {}),
    });
  }
  return [...models.values()];
}

/** Parse the strict public half of the agent-signed runtime catalog. */
export function parseWorkspaceAgentModelFamilies(
  value: unknown,
): WorkspaceAgentModelFamily[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return undefined;
  }
  const families = new Map<string, WorkspaceAgentModelFamily>();
  const labels = new Map<string, string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as Record<string, unknown>;
    const rawEfforts = candidate.efforts;
    if (
      Object.keys(candidate).length !== 5 ||
      !["id", "name", "description", "default_effort", "efforts"].every(
        (key) => key in candidate,
      ) ||
      typeof candidate.id !== "string" ||
      !MODEL_ID.test(candidate.id) ||
      candidate.id === "default" ||
      typeof candidate.name !== "string" ||
      !candidate.name.trim() ||
      candidate.name.trim().toLowerCase() === "runtime default" ||
      typeof candidate.description !== "string" ||
      !isWorkspaceReasoningEffort(candidate.default_effort) ||
      !Array.isArray(rawEfforts) ||
      rawEfforts.length === 0 ||
      !rawEfforts.every(isWorkspaceReasoningEffort)
    ) {
      return undefined;
    }
    const efforts = WORKSPACE_REASONING_EFFORTS.filter((effort) =>
      rawEfforts.includes(effort),
    );
    if (!efforts.includes(candidate.default_effort)) return undefined;
    const family: WorkspaceAgentModelFamily = {
      id: candidate.id,
      name: candidate.name.trim(),
      description: candidate.description,
      defaultEffort: candidate.default_effort,
      efforts,
    };
    const existing = families.get(family.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(family)) return undefined;
      continue;
    }
    const normalizedLabel = family.name.toLowerCase();
    if (labels.has(normalizedLabel)) return undefined;
    labels.set(normalizedLabel, family.id);
    families.set(family.id, family);
  }
  return [...families.values()];
}

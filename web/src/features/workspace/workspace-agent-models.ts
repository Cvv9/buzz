export type WorkspaceAgentModel = { id: string; name?: string };

/** Parse the bounded capability catalog published by a live ACP adapter. */
export function parseWorkspaceAgentModels(
  value: unknown,
): WorkspaceAgentModel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.id !== "string" || !candidate.id.trim()) return [];
      return [
        {
          id: candidate.id.trim(),
          ...(typeof candidate.name === "string" && candidate.name.trim()
            ? { name: candidate.name.trim() }
            : {}),
        },
      ];
    })
    .slice(0, 100);
}

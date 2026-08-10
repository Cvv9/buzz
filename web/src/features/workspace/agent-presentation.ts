import type { WorkspaceProfile } from "./workspace-api";

export function agentAccessLabel(agent: WorkspaceProfile): string {
  if (agent.accessTier === "personal") return "Private to you";
  if (agent.accessTier === "admin") return "Admins only";
  return "Available to everyone";
}

export function agentRoleLabel(agent: WorkspaceProfile): string {
  const summary = agent.about?.split(/[.,;\n]/)[0]?.trim();
  const roleAlias = agent.aliases?.find(
    (alias) =>
      alias.trim() && alias !== agent.name && alias.toLowerCase() !== "io",
  );
  return roleAlias ?? summary ?? agentAccessLabel(agent);
}

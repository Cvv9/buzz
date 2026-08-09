import type { WorkspaceProfile } from "./workspace-api";

export function agentAccessLabel(agent: WorkspaceProfile): string {
  if (agent.accessTier === "personal") return "Private to you";
  if (agent.accessTier === "admin") return "Admins only";
  return "Available to everyone";
}

export function agentRoleLabel(agent: WorkspaceProfile): string {
  return (
    agent.aliases?.find((alias) => alias.trim() && alias !== agent.name) ??
    agent.about?.split(/[.,;\n]/)[0]?.trim() ??
    agentAccessLabel(agent)
  );
}

import type { AgentPersona, AgentTeam } from "@/shared/api/types";

const STARTER_PERSONA_IDS = new Set([
  "builtin:fizz",
  "builtin:honey",
  "builtin:bumble",
]);
const STARTER_TEAM_ID = "builtin-team:welcome";

/**
 * Hosted communities use relay agents as their operational roster. The local
 * starter trio remains available to first-run onboarding, but must not appear
 * as a second, conflicting roster once hosted agents are available.
 */
export function localRosterForHostedCommunity(
  personas: readonly AgentPersona[],
  teams: readonly AgentTeam[],
  hasHostedAgents: boolean,
) {
  if (!hasHostedAgents) return { personas: [...personas], teams: [...teams] };

  return {
    personas: personas.filter(
      (persona) => !persona.isBuiltIn || !STARTER_PERSONA_IDS.has(persona.id),
    ),
    teams: teams.filter(
      (team) => !team.isBuiltin || team.id !== STARTER_TEAM_ID,
    ),
  };
}

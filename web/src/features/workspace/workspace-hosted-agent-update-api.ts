import type { WorkspaceProfile } from "./workspace-api";
import { publishHostedAgentRuntimeRequest } from "./workspace-agent-runtime-api";
import { publishHostedAgentConfig } from "./workspace-hosted-agent-config-api";
import {
  executeHostedAgentUpdatePlan,
  type HostedAgentUpdate,
  planHostedAgentUpdate,
} from "./workspace-hosted-agent-update-policy";

/** Publish presentation and runtime updates after one fail-closed preflight. */
export async function updateHostedAgent(
  agent: WorkspaceProfile,
  update: HostedAgentUpdate,
): Promise<void> {
  const plan = planHostedAgentUpdate(agent, update);
  await executeHostedAgentUpdatePlan(plan, {
    publishPresentation: publishHostedAgentConfig,
    publishRuntime: ({
      agentPubkey,
      model,
      effort,
      presentationEventId,
      catalogDigest,
    }) =>
      publishHostedAgentRuntimeRequest({
        agentPubkey,
        model,
        effort,
        presentationEventId,
        catalogDigest,
      }),
  });
}

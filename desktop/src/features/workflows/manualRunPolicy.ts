import type {
  AgentScheduledWorkflow,
  WorkflowResultReference,
} from "@/shared/api/workflowTypes";

export const MANUAL_WORKFLOW_COPY =
  "Starts fresh and may repeat prior actions. Uses the configured provider and fallback. 20 minutes; two total attempts; 15-minute cooldown; 3/workflow/day, 10/workspace/day; 1 active/agent, 2/workspace. These are execution limits, not a spending cap.";

const reasons: Record<string, string> = {
  workflow_disabled: "This workflow is paused.",
  workflow_owner_required: "Only this workflow’s owner can run it.",
  owner_required: "Only the community owner can run this workflow.",
  permission_revoked: "Access changed. Refresh this workflow.",
  unsupported_manual_profile: "This workflow does not support manual runs.",
  association_unresolved: "The agent association has not been verified.",
  capability_unavailable: "The agent is not ready for a manual run.",
  capability_stale: "The agent has not recently confirmed it is ready.",
  workflow_cooldown: "Wait for the workflow cooldown to finish.",
  runner_unavailable: "The agent is not ready for a manual run.",
  workflow_active: "This workflow already has an active run.",
  community_active_limit: "This workspace already has two active manual runs.",
  agent_active_limit: "This agent already has an active run.",
  unsupported_manual_destination:
    "This destination does not support manual runs.",
  cooldown: "Wait for the workflow cooldown to finish.",
  workflow_daily_limit: "This workflow has used its daily allowance.",
  community_daily_limit: "This workspace has used its daily allowance.",
  agent_busy: "This agent already has an active run.",
  workflow_busy: "This workflow already has an active run.",
  community_busy: "This workspace already has two active manual runs.",
  definition_changed: "The workflow changed. Review the refreshed definition.",
  legacy_execution_unknown:
    "The earlier run’s outcome is unknown. Operator recovery is required.",
  worker_stop_unconfirmed:
    "The agent has not confirmed stopping. Operator recovery is required.",
};

/** Fixed reviewed copy only; provider diagnostics must never reach settings. */
export function manualWorkflowReason(code: string | null): string | null {
  return code
    ? (reasons[code] ??
        "Manual execution is unavailable. Refresh for the latest status.")
    : null;
}

/** Time passing cannot override the server's eligibility decision. */
export function manualWorkflowBlocked(
  row: AgentScheduledWorkflow,
): string | null {
  if (!row.enabled) return manualWorkflowReason("workflow_disabled");
  if (row.blockReason) return manualWorkflowReason(row.blockReason);
  if (row.limits.remainingWorkflow === 0)
    return manualWorkflowReason("workflow_daily_limit");
  if (row.limits.remainingCommunity === 0)
    return manualWorkflowReason("community_daily_limit");
  return null;
}

export function workflowScheduleLabel(
  schedule: Record<string, unknown>,
): string {
  if (typeof schedule.cron === "string") return `Cron: ${schedule.cron}`;
  if (typeof schedule.interval === "string")
    return `Every ${schedule.interval}`;
  if (typeof schedule.interval_secs === "number")
    return `Every ${schedule.interval_secs} seconds`;
  return "Scheduled workflow";
}

/** Ignore server-supplied URLs. Build a typed local destination from verified ids. */
export function safeWorkflowResult(
  channelId: string,
  result: WorkflowResultReference,
): { channelId: string; messageId: string } | null {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(channelId) ||
    result.channelId !== channelId ||
    !/^[0-9a-f]{64}$/i.test(result.eventId)
  )
    return null;
  return { channelId, messageId: result.eventId };
}

export function scheduledWorkflowQueryKey(
  community: string,
  relay: string,
  owner: string,
  agent: string,
) {
  return ["agent-scheduled-workflows", community, relay, owner, agent] as const;
}

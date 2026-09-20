import { invokeTauri } from "@/shared/api/tauri";
import type {
  ApprovalActionResponse,
  TriggerWorkflowResponse,
  Workflow,
  WorkflowApproval,
  WorkflowRun,
  WorkflowSaveResult,
  TraceEntry,
} from "@/shared/api/types";

// ── Raw types (snake_case from backend) ───────────────────────────────────

type RawWorkflow = {
  id: string;
  revision: string;
  name: string;
  owner_pubkey: string;
  channel_id: string | null;
  definition: Record<string, unknown>;
  status: Workflow["status"];
  created_at: number;
  updated_at: number;
};

type RawWorkflowSaveResponse = RawWorkflow & {
  webhook_secret?: string | null;
};

type RawTraceEntry = {
  step_id: string;
  status: string;
  output?: Record<string, unknown>;
  started_at?: number | null;
  completed_at?: number | null;
  error?: string | null;
};

type RawWorkflowRun = {
  id: string;
  workflow_id: string;
  status: WorkflowRun["status"];
  current_step: number | null;
  execution_trace: RawTraceEntry[];
  started_at: number | null;
  completed_at: number | null;
  error_code?: string | null;
  error_message: string | null;
  created_at: number;
};

type RawWorkflowRunCursor = {
  before: string;
  before_id: string;
};

type RawWorkflowRunsResponse = {
  runs: RawWorkflowRun[];
  next: RawWorkflowRunCursor | null;
};

type RawWorkflowApproval = {
  approval_ref: string;
  workflow_id: string;
  run_id: string;
  step_id: string;
  step_index: number;
  approver_spec: string;
  status: WorkflowApproval["status"];
  approver_pubkey: string | null;
  note: string | null;
  expires_at: string;
  created_at: number;
};

type RawWorkflowApprovalsResponse = {
  approvals: RawWorkflowApproval[];
};

type RawTriggerWorkflowResponse = {
  run_id: string;
  workflow_id: string;
  status: string;
};

type RawApprovalActionResponse = {
  token: string;
  status: string;
  run_id: string;
  workflow_id: string;
};

// ── Conversion functions ──────────────────────────────────────────────────

function fromRawWorkflow(raw: RawWorkflow): Workflow {
  return {
    id: raw.id,
    revision: raw.revision,
    name: raw.name,
    ownerPubkey: raw.owner_pubkey,
    channelId: raw.channel_id,
    definition: raw.definition,
    status: raw.status,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function fromRawWorkflowSave(raw: RawWorkflowSaveResponse): WorkflowSaveResult {
  return {
    workflow: fromRawWorkflow(raw),
    webhookSecret: raw.webhook_secret ?? null,
  };
}

function fromRawTraceEntry(raw: RawTraceEntry): TraceEntry {
  return {
    stepId: raw.step_id,
    status: raw.status,
    output: raw.output ?? {},
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    error: raw.error ?? null,
  };
}

function fromRawWorkflowRun(raw: RawWorkflowRun): WorkflowRun {
  return {
    id: raw.id,
    workflowId: raw.workflow_id,
    status: raw.status,
    currentStep: raw.current_step,
    executionTrace: raw.execution_trace.map(fromRawTraceEntry),
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    errorCode: raw.error_code ?? null,
    errorMessage: raw.error_message,
    createdAt: raw.created_at,
  };
}

export function fromRawApproval(raw: RawWorkflowApproval): WorkflowApproval {
  return {
    approvalRef: raw.approval_ref,
    workflowId: raw.workflow_id,
    runId: raw.run_id,
    stepId: raw.step_id,
    stepIndex: raw.step_index,
    approverSpec: raw.approver_spec,
    status: raw.status,
    approverPubkey: raw.approver_pubkey,
    note: raw.note,
    expiresAt: raw.expires_at,
    createdAt: raw.created_at,
  };
}

function fromRawTriggerResponse(
  raw: RawTriggerWorkflowResponse,
): TriggerWorkflowResponse {
  return {
    runId: raw.run_id,
    workflowId: raw.workflow_id,
    status: raw.status,
  };
}

function fromRawApprovalResponse(
  raw: RawApprovalActionResponse,
): ApprovalActionResponse {
  return {
    token: raw.token,
    status: raw.status,
    runId: raw.run_id,
    workflowId: raw.workflow_id,
  };
}

// ── Tauri invoke wrappers ─────────────────────────────────────────────────

export async function getChannelWorkflows(
  channelId: string,
): Promise<Workflow[]> {
  const raw = await invokeTauri<RawWorkflow[]>("get_channel_workflows", {
    channelId,
  });
  return raw.map(fromRawWorkflow);
}

/**
 * Fetch workflows across many channels in a single relay round-trip.
 *
 * Replaces the per-channel `Promise.all(getChannelWorkflows)` fanout on the
 * Workflows overview: the backend `#h` filter matches any listed channel, and
 * each returned workflow carries its own `channelId` so callers can group.
 */
export async function getChannelsWorkflows(
  channelIds: string[],
): Promise<Workflow[]> {
  const raw = await invokeTauri<RawWorkflow[]>("get_channels_workflows", {
    channelIds,
  });
  return raw.map(fromRawWorkflow);
}

export async function getWorkflow(workflowId: string): Promise<Workflow> {
  const raw = await invokeTauri<RawWorkflow>("get_workflow", { workflowId });
  return fromRawWorkflow(raw);
}

export async function createWorkflow(
  channelId: string,
  yamlDefinition: string,
): Promise<WorkflowSaveResult> {
  const raw = await invokeTauri<RawWorkflowSaveResponse>("create_workflow", {
    channelId,
    yamlDefinition,
  });
  return fromRawWorkflowSave(raw);
}

export async function updateWorkflow(
  workflowId: string,
  yamlDefinition: string,
  expectedRevision: string,
): Promise<WorkflowSaveResult> {
  const raw = await invokeTauri<RawWorkflowSaveResponse>("update_workflow", {
    workflowId,
    yamlDefinition,
    expectedRevision,
  });
  return fromRawWorkflowSave(raw);
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  await invokeTauri("delete_workflow", { workflowId });
}

export async function getWorkflowRuns(
  workflowId: string,
  limit?: number,
): Promise<WorkflowRun[]> {
  const raw = await invokeTauri<RawWorkflowRunsResponse>("get_workflow_runs", {
    workflowId,
    limit: limit ?? null,
  });
  return raw.runs.map(fromRawWorkflowRun);
}

export async function getRunApprovals(
  workflowId: string,
  runId: string,
): Promise<WorkflowApproval[]> {
  const raw = await invokeTauri<RawWorkflowApprovalsResponse>(
    "get_run_approvals",
    {
      workflowId,
      runId,
    },
  );
  return raw.approvals.map(fromRawApproval);
}

export async function triggerWorkflow(
  workflowId: string,
): Promise<TriggerWorkflowResponse> {
  const raw = await invokeTauri<RawTriggerWorkflowResponse>(
    "trigger_workflow",
    { workflowId },
  );
  return fromRawTriggerResponse(raw);
}

export async function grantApproval(
  token: string,
  note?: string,
): Promise<ApprovalActionResponse> {
  const raw = await invokeTauri<RawApprovalActionResponse>("grant_approval", {
    token,
    note: note ?? null,
  });
  return fromRawApprovalResponse(raw);
}

export async function denyApproval(
  token: string,
  note?: string,
): Promise<ApprovalActionResponse> {
  const raw = await invokeTauri<RawApprovalActionResponse>("deny_approval", {
    token,
    note: note ?? null,
  });
  return fromRawApprovalResponse(raw);
}

// Settings uses the allowlisted summary projection, never detailed execution traces.
import type {
  AgentScheduledWorkflowsPage,
  ManualWorkflowLimits,
  ManualWorkflowReceipt,
  ManualWorkflowScope,
  PreparedManualWorkflow,
  WorkflowExecutionState,
} from "./workflowTypes";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid workflow response.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid workflow response.");
  return value;
}
function optionalText(value: unknown): string | null {
  return value == null ? null : text(value);
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid workflow response.");
  return value;
}
/** Summary clocks are ISO UTC; legacy history times are Unix seconds. */
export function workflowTimestamp(value: unknown): number | null {
  if (value == null) return null;
  const millis =
    typeof value === "number"
      ? value * 1000
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(millis)) throw new Error("Invalid workflow time.");
  return millis;
}
function serverTime(value: unknown): number {
  const time = workflowTimestamp(value);
  if (time === null) throw new Error("Missing workflow server time.");
  return time;
}
function fromManualLimits(value: unknown): ManualWorkflowLimits {
  const raw = record(value);
  return {
    remainingWorkflow: count(raw.remaining_workflow),
    remainingCommunity: count(raw.remaining_community),
    nextEligibleAt: workflowTimestamp(raw.next_eligible_at),
    serverNow: serverTime(raw.server_now),
  };
}
export function fromManualWorkflowReceipt(
  value: unknown,
): ManualWorkflowReceipt {
  const raw = record(value);
  if (typeof raw.accepted !== "boolean")
    throw new Error("Missing workflow decision.");
  const runId = optionalText(raw.run_id);
  const reason = optionalText(raw.reason);
  if ((raw.accepted && !runId) || (!raw.accepted && !reason))
    throw new Error("Incomplete workflow decision.");
  return {
    accepted: raw.accepted,
    runId,
    reason,
    revision: count(raw.revision),
    limits: fromManualLimits(raw.limits),
  };
}
const executionStates = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "timed_out",
  "stalled",
]);
export function fromAgentScheduledWorkflows(
  value: unknown,
): AgentScheduledWorkflowsPage {
  const raw = record(value);
  if (!Array.isArray(raw.workflows))
    throw new Error("Missing scheduled workflows.");
  return {
    next: optionalText(raw.next),
    serverNow: serverTime(raw.server_now),
    workflows: raw.workflows.map((entry) => {
      const row = record(entry);
      if (!Array.isArray(row.agent_targets) || typeof row.enabled !== "boolean")
        throw new Error("Invalid scheduled workflow.");
      const run = row.last_run == null ? null : record(row.last_run);
      return {
        workflowId: text(row.workflow_id),
        name: text(row.name),
        definitionHash: text(row.definition_hash),
        agentTargets: row.agent_targets.map(text),
        channelId: text(row.channel_id),
        schedule: record(row.schedule),
        timezone: text(row.timezone),
        nextScheduledAt: workflowTimestamp(row.next_scheduled_at),
        enabled: row.enabled,
        blockReason: optionalText(row.block_reason),
        limits: fromManualLimits(row.limits),
        revision: count(row.revision),
        lastRun: run
          ? {
              id: text(run.id),
              executionState: (executionStates.has(String(run.execution_state))
                ? run.execution_state
                : "unknown") as WorkflowExecutionState,
              safeErrorCode: optionalText(run.safe_error_code),
              origin: optionalText(run.origin),
              requester: optionalText(run.requester),
              startedAt: workflowTimestamp(run.started_at),
              completedAt: workflowTimestamp(run.completed_at),
              acceptedAt: workflowTimestamp(run.accepted_at),
              deadlineAt: workflowTimestamp(run.deadline_at),
              revision: count(run.revision ?? 0),
              results: Array.isArray(run.results)
                ? run.results.map((value) => {
                    const result = record(value);
                    return {
                      taskId: text(result.task_id),
                      channelId: text(result.channel_id),
                      eventId: text(result.event_id),
                    };
                  })
                : [],
            }
          : null,
      };
    }),
  };
}
function rawManualScope(scope: ManualWorkflowScope) {
  return { relay_url: scope.relayUrl, owner_pubkey: scope.ownerPubkey };
}
export async function getAgentScheduledWorkflows(
  scope: ManualWorkflowScope,
  agentPubkey: string,
  cursor: string | null,
): Promise<AgentScheduledWorkflowsPage> {
  return fromAgentScheduledWorkflows(
    await invokeTauri("get_agent_scheduled_workflows", {
      scope: rawManualScope(scope),
      agentPubkey,
      cursor,
    }),
  );
}
export async function prepareManualWorkflow(
  scope: ManualWorkflowScope,
  workflowId: string,
  definitionHash: string,
): Promise<PreparedManualWorkflow> {
  return invokeTauri("prepare_manual_workflow", {
    scope: rawManualScope(scope),
    workflowId,
    definitionHash,
  });
}
export async function submitManualWorkflow(
  request: PreparedManualWorkflow,
): Promise<ManualWorkflowReceipt> {
  return fromManualWorkflowReceipt(
    await invokeTauri("submit_manual_workflow", { request }),
  );
}

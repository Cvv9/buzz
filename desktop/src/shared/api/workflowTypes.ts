export type WorkflowStatus = "active" | "disabled" | "archived";

export type Workflow = {
  id: string;
  revision: string;
  name: string;
  ownerPubkey: string;
  channelId: string | null;
  definition: Record<string, unknown>;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowSaveResult = {
  workflow: Workflow;
  webhookSecret: string | null;
};

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_approval";

export type TraceEntry = {
  stepId: string;
  status: string;
  output: Record<string, unknown>;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  currentStep: number | null;
  executionTrace: TraceEntry[];
  startedAt: number | null;
  completedAt: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
};

export type WorkflowApprovalStatus =
  | "pending"
  | "granted"
  | "denied"
  | "expired";

export type WorkflowApproval = {
  /** Opaque, non-actionable identifier for display/correlation only. */
  approvalRef: string;
  workflowId: string;
  runId: string;
  stepId: string;
  stepIndex: number;
  approverSpec: string;
  status: WorkflowApprovalStatus;
  approverPubkey: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: number;
};

export type TriggerWorkflowResponse = {
  runId: string;
  workflowId: string;
  status: string;
};

export type ApprovalActionResponse = {
  token: string;
  status: string;
  runId: string;
  workflowId: string;
};

/** Actual execution state; dispatch history is a separate projection. */
export type WorkflowExecutionState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "stalled"
  | "unknown";
export type ManualWorkflowScope = { relayUrl: string; ownerPubkey: string };
/** Public signed bytes only. Never edit or re-sign this envelope during a retry. */
export type PreparedManualWorkflow = {
  scope: { relay_url: string; owner_pubkey: string };
  workflow_id: string;
  definition_hash: string;
  event: { id: string; [key: string]: unknown };
};
export type ManualWorkflowLimits = {
  remainingWorkflow: number;
  remainingCommunity: number;
  nextEligibleAt: number | null;
  serverNow: number;
};
export type ManualWorkflowReceipt = {
  accepted: boolean;
  runId: string | null;
  reason: string | null;
  revision: number;
  limits: ManualWorkflowLimits;
};
export type WorkflowResultReference = {
  taskId: string;
  channelId: string;
  eventId: string;
};
export type ScheduledWorkflowRun = {
  id: string;
  executionState: WorkflowExecutionState;
  safeErrorCode: string | null;
  origin: string | null;
  requester: string | null;
  startedAt: number | null;
  completedAt: number | null;
  acceptedAt: number | null;
  deadlineAt: number | null;
  revision: number;
  results: WorkflowResultReference[];
};
export type AgentScheduledWorkflow = {
  workflowId: string;
  name: string;
  definitionHash: string;
  agentTargets: string[];
  channelId: string;
  schedule: Record<string, unknown>;
  timezone: string;
  nextScheduledAt: number | null;
  enabled: boolean;
  lastRun: ScheduledWorkflowRun | null;
  limits: ManualWorkflowLimits;
  blockReason: string | null;
  revision: number;
};
export type AgentScheduledWorkflowsPage = {
  workflows: AgentScheduledWorkflow[];
  next: string | null;
  serverNow: number;
};

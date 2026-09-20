import { parseDocument } from "yaml";

const MAX_WORKFLOW_YAML_BYTES = 64 * 1024;
const WORKFLOW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEP_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;
const APPROVAL_HASH_PATTERN = /^[0-9a-f]{64}$/;

export type WorkflowTrigger =
  | { on: "message_posted"; filter?: string }
  | { on: "reaction_added"; emoji?: string }
  | { on: "diff_posted"; filter?: string }
  | { on: "member_joined"; include_bots?: boolean }
  | { on: "schedule"; cron?: string; interval?: string }
  | { on: "webhook" };

export type WorkflowAction =
  | {
      action: "send_message";
      text: string;
      channel?: string;
      agent_targets?: string[];
    }
  | { action: "send_dm"; to: string; text: string }
  | { action: "set_channel_topic"; topic: string }
  | { action: "add_reaction"; emoji: string }
  | {
      action: "call_webhook";
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  | {
      action: "request_approval";
      from: string;
      message: string;
      timeout?: string;
    }
  | { action: "delay"; duration: string };

export type WorkflowStep = {
  id: string;
  name?: string;
  if?: string;
  timeout_secs?: number;
} & WorkflowAction;

export type WorkflowDefinition = {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  enabled: boolean;
};

export type ReplaceableWorkflowHead = {
  id: string;
  created_at: number;
};

export type WorkflowEventEnvelope = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: unknown;
  content: string;
};

export type ParsedWorkflowDefinitionEvent = {
  id: string;
  workflowId: string;
  channelId: string;
  ownerPubkey: string;
  createdAt: number;
  yaml: string;
  definition: WorkflowDefinition;
};

export type ParsedWorkflowApprovalRequest = {
  eventId: string;
  tokenHash: string;
  channelId: string | null;
  workflowId: string | null;
  content: string;
  createdAt: number;
};

/**
 * Browser-visible capabilities for the relay currently serving this web app.
 *
 * The YAML schema deliberately remains broader than this list: the browser must
 * be able to read historical definitions and relay support can expand without
 * changing their wire format. These flags only decide which definitions the web
 * editor is allowed to create or replace.
 */
export const BROWSER_WORKFLOW_CAPABILITIES = {
  approvalRequests: false,
} as const;

function invalid(message: string): never {
  throw new Error(`Invalid workflow definition: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${path} must be a mapping.`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") invalid(`${path} must be true or false.`);
  return value;
}

function optionalPositiveInteger(
  value: unknown,
  path: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${path} must be a non-negative integer.`);
  }
  return value;
}

function allowedKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`${path}.${key} is not supported.`);
  }
}

function duration(value: unknown, path: string, minimumSeconds = 0): string {
  const parsed = string(value, path).trim();
  const match = /^(\d+)\s*([hms])?$/.exec(parsed);
  if (!match) {
    invalid(`${path} must be a duration such as 30m, 1h, or 60s.`);
  }
  const count = Number(match[1]);
  const multiplier = match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1;
  if (!Number.isSafeInteger(count) || count * multiplier < minimumSeconds) {
    invalid(`${path} must be at least ${minimumSeconds}s.`);
  }
  return parsed;
}

function workflowUuid(value: string, path: string) {
  if (!WORKFLOW_ID_PATTERN.test(value)) invalid(`${path} must be a UUID.`);
}

function parseTrigger(value: unknown): WorkflowTrigger {
  const trigger = record(value, "trigger");
  const on = string(trigger.on, "trigger.on");
  switch (on) {
    case "message_posted":
    case "diff_posted": {
      allowedKeys(trigger, ["on", "filter"], "trigger");
      const filter = optionalString(trigger.filter, "trigger.filter");
      return filter ? { on, filter } : { on };
    }
    case "reaction_added": {
      allowedKeys(trigger, ["on", "emoji"], "trigger");
      const emoji = optionalString(trigger.emoji, "trigger.emoji");
      return emoji ? { on, emoji } : { on };
    }
    case "member_joined": {
      allowedKeys(trigger, ["on", "include_bots"], "trigger");
      const includeBots = optionalBoolean(
        trigger.include_bots,
        "trigger.include_bots",
      );
      return includeBots === undefined
        ? { on }
        : { on, include_bots: includeBots };
    }
    case "schedule": {
      allowedKeys(trigger, ["on", "cron", "interval"], "trigger");
      const cron = optionalString(trigger.cron, "trigger.cron");
      const interval =
        trigger.interval === undefined
          ? undefined
          : duration(trigger.interval, "trigger.interval", 60);
      if ((cron ? 1 : 0) + (interval ? 1 : 0) !== 1) {
        invalid("trigger.schedule requires exactly one of cron or interval.");
      }
      if (cron) {
        const fields = cron.trim().split(/\s+/).length;
        if (![5, 6, 7].includes(fields)) {
          invalid("trigger.cron must have 5, 6, or 7 fields.");
        }
      }
      return cron ? { on, cron } : { on, interval: interval ?? "" };
    }
    case "webhook":
      allowedKeys(trigger, ["on"], "trigger");
      return { on };
    default:
      invalid(`trigger.on '${on}' is not supported.`);
  }
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const headers = record(value, "step.headers");
  return Object.fromEntries(
    Object.entries(headers).map(([key, headerValue]) => [
      string(key, "step.headers key"),
      string(headerValue, `step.headers.${key}`),
    ]),
  );
}

function parseAction(step: Record<string, unknown>): WorkflowAction {
  const action = string(step.action, "step.action");
  switch (action) {
    case "send_message": {
      allowedKeys(
        step,
        [
          "id",
          "name",
          "if",
          "timeout_secs",
          "action",
          "text",
          "channel",
          "agent_targets",
        ],
        "step",
      );
      const channel = optionalString(step.channel, "step.channel");
      if (channel) workflowUuid(channel, "step.channel");
      const targets = step.agent_targets;
      if (
        targets !== undefined &&
        (!Array.isArray(targets) ||
          targets.some(
            (target) =>
              typeof target !== "string" || !EVENT_ID_PATTERN.test(target),
          ) ||
          new Set(targets).size !== targets.length)
      ) {
        invalid(
          "step.agent_targets must contain distinct lowercase public keys.",
        );
      }
      return {
        action,
        text: string(step.text, "step.text"),
        ...(channel ? { channel } : {}),
        ...(targets === undefined
          ? {}
          : { agent_targets: targets as string[] }),
      };
    }
    case "send_dm":
      allowedKeys(
        step,
        ["id", "name", "if", "timeout_secs", "action", "to", "text"],
        "step",
      );
      return {
        action,
        to: string(step.to, "step.to"),
        text: string(step.text, "step.text"),
      };
    case "set_channel_topic":
      allowedKeys(
        step,
        ["id", "name", "if", "timeout_secs", "action", "topic"],
        "step",
      );
      return { action, topic: string(step.topic, "step.topic") };
    case "add_reaction":
      allowedKeys(
        step,
        ["id", "name", "if", "timeout_secs", "action", "emoji"],
        "step",
      );
      return { action, emoji: string(step.emoji, "step.emoji") };
    case "call_webhook": {
      allowedKeys(
        step,
        [
          "id",
          "name",
          "if",
          "timeout_secs",
          "action",
          "url",
          "method",
          "headers",
          "body",
        ],
        "step",
      );
      const url = string(step.url, "step.url");
      try {
        if (new URL(url).protocol !== "https:") {
          invalid("step.url must use HTTPS.");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Invalid workflow")
        ) {
          throw error;
        }
        invalid("step.url must be a valid HTTPS URL.");
      }
      const method = optionalString(step.method, "step.method");
      const body = optionalString(step.body, "step.body");
      const headers = parseHeaders(step.headers);
      return {
        action,
        url,
        ...(method ? { method } : {}),
        ...(headers ? { headers } : {}),
        ...(body ? { body } : {}),
      };
    }
    case "request_approval": {
      allowedKeys(
        step,
        [
          "id",
          "name",
          "if",
          "timeout_secs",
          "action",
          "from",
          "message",
          "timeout",
        ],
        "step",
      );
      const timeout =
        step.timeout === undefined
          ? undefined
          : duration(step.timeout, "step.timeout");
      return {
        action,
        from: string(step.from, "step.from"),
        message: string(step.message, "step.message"),
        ...(timeout ? { timeout } : {}),
      };
    }
    case "delay":
      allowedKeys(
        step,
        ["id", "name", "if", "timeout_secs", "action", "duration"],
        "step",
      );
      return { action, duration: duration(step.duration, "step.duration") };
    default:
      invalid(`step.action '${action}' is not supported.`);
  }
}

function parseStep(value: unknown): WorkflowStep {
  const step = record(value, "step");
  const id = string(step.id, "step.id");
  if (!STEP_ID_PATTERN.test(id)) {
    invalid("step.id must contain only letters, numbers, and underscores.");
  }
  const name = optionalString(step.name, "step.name");
  const ifExpr = optionalString(step.if, "step.if");
  const timeoutSeconds = optionalPositiveInteger(
    step.timeout_secs,
    "step.timeout_secs",
  );
  return {
    id,
    ...(name ? { name } : {}),
    ...(ifExpr ? { if: ifExpr } : {}),
    ...(timeoutSeconds === undefined ? {} : { timeout_secs: timeoutSeconds }),
    ...parseAction(step),
  };
}

/** Parse and validate the relay's YAML workflow schema before rendering or publishing it. */
export function parseWorkflowDefinition(yaml: string): WorkflowDefinition {
  if (!yaml.trim()) invalid("YAML is required.");
  if (new TextEncoder().encode(yaml).byteLength > MAX_WORKFLOW_YAML_BYTES) {
    invalid("YAML exceeds the 64 KiB browser safety limit.");
  }
  const document = parseDocument(yaml, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) {
    invalid(document.errors[0]?.message ?? "YAML could not be parsed.");
  }
  const definition = record(document.toJS(), "workflow");
  allowedKeys(
    definition,
    ["name", "description", "trigger", "steps", "enabled"],
    "workflow",
  );
  const stepsValue = definition.steps;
  if (!Array.isArray(stepsValue) || stepsValue.length === 0) {
    invalid("steps must be a non-empty list.");
  }
  const steps = stepsValue.map(parseStep);
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.id)) invalid(`duplicate step.id '${step.id}'.`);
    stepIds.add(step.id);
  }
  const description = optionalString(definition.description, "description");
  const enabled = optionalBoolean(definition.enabled, "enabled") ?? true;
  return {
    name: string(definition.name, "name"),
    ...(description ? { description } : {}),
    trigger: parseTrigger(definition.trigger),
    steps,
    enabled,
  };
}

/**
 * Reject a browser write that the deployed relay cannot carry through to a
 * user-visible result. Keep this separate from parseWorkflowDefinition() so
 * existing valid YAML remains readable and portable across richer clients.
 */
export function validateBrowserWorkflowPublication(
  yaml: string,
): WorkflowDefinition {
  const definition = parseWorkflowDefinition(yaml);
  if (
    !BROWSER_WORKFLOW_CAPABILITIES.approvalRequests &&
    definition.steps.some((step) => step.action === "request_approval")
  ) {
    throw new Error(
      "Approval steps cannot be saved from Buzz Web because this relay does not yet deliver approval requests end-to-end. Remove the approval step or use a supported action.",
    );
  }
  return definition;
}

/** Update only the portable YAML definition flag; relay DB lifecycle remains server-owned. */
export function setWorkflowDefinitionEnabled(
  yaml: string,
  enabled: boolean,
): string {
  parseWorkflowDefinition(yaml);
  const document = parseDocument(yaml, { prettyErrors: false, strict: true });
  document.set("enabled", enabled);
  const next = document.toString();
  parseWorkflowDefinition(next);
  return next;
}

/** NIP-16 head order is created_at then lowest event id. */
export function isNewerWorkflowHead(
  candidate: ReplaceableWorkflowHead,
  current: ReplaceableWorkflowHead,
): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}

export function isWorkflowUuid(value: string): boolean {
  return WORKFLOW_ID_PATTERN.test(value);
}

export function workflowTriggerLabel(trigger: WorkflowTrigger): string {
  const labels: Record<WorkflowTrigger["on"], string> = {
    message_posted: "Message posted",
    reaction_added: "Reaction added",
    diff_posted: "Diff posted",
    member_joined: "Member joined",
    schedule: "Schedule",
    webhook: "Webhook",
  };
  return labels[trigger.on];
}

function eventTags(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null;
  const tags: string[][] = [];
  for (const tag of value) {
    if (!Array.isArray(tag) || tag.some((part) => typeof part !== "string")) {
      return null;
    }
    tags.push(tag);
  }
  return tags;
}

function exactlyOneEventTag(tags: string[][], name: string): string | null {
  const matches = tags.filter((tag) => tag[0] === name);
  if (matches.length !== 1 || !matches[0]?.[1]?.trim()) return null;
  return matches[0][1] ?? null;
}

function optionalSingleEventTag(
  tags: string[][],
  name: string,
): string | null | undefined {
  const matches = tags.filter((tag) => tag[0] === name);
  if (matches.length === 0) return undefined;
  if (matches.length !== 1 || !matches[0]?.[1]?.trim()) return null;
  return matches[0][1];
}

function validEventEnvelope(event: WorkflowEventEnvelope): boolean {
  return (
    EVENT_ID_PATTERN.test(event.id) &&
    EVENT_ID_PATTERN.test(event.pubkey) &&
    event.pubkey === event.pubkey.toLowerCase() &&
    Number.isSafeInteger(event.created_at) &&
    event.created_at >= 0 &&
    typeof event.content === "string"
  );
}

/** Strictly decode a channel-scoped kind 30620 envelope before projecting YAML. */
export function parseWorkflowDefinitionEvent(
  event: WorkflowEventEnvelope,
): ParsedWorkflowDefinitionEvent | null {
  if (event.kind !== 30620 || !validEventEnvelope(event)) return null;
  const tags = eventTags(event.tags);
  if (!tags) return null;
  const workflowId = exactlyOneEventTag(tags, "d");
  const channelId = exactlyOneEventTag(tags, "h");
  if (
    !workflowId ||
    !channelId ||
    !isWorkflowUuid(workflowId) ||
    !isWorkflowUuid(channelId)
  ) {
    return null;
  }
  try {
    return {
      id: event.id,
      workflowId: workflowId.toLowerCase(),
      channelId: channelId.toLowerCase(),
      ownerPubkey: event.pubkey,
      createdAt: event.created_at,
      yaml: event.content,
      definition: parseWorkflowDefinition(event.content),
    };
  } catch {
    return null;
  }
}

/**
 * Decode only approval requests addressed to the active viewer. Relay filters
 * are an optimization, not an authorization boundary, so this check is local
 * and fail-closed as well.
 */
export function parseWorkflowApprovalRequestEvent(
  event: WorkflowEventEnvelope,
  viewerPubkey: string,
): ParsedWorkflowApprovalRequest | null {
  const viewer = viewerPubkey.toLowerCase();
  if (
    event.kind !== 46010 ||
    !validEventEnvelope(event) ||
    !EVENT_ID_PATTERN.test(viewer) ||
    viewer !== viewerPubkey
  ) {
    return null;
  }
  const tags = eventTags(event.tags);
  if (!tags?.some((tag) => tag[0] === "p" && tag[1] === viewer)) {
    return null;
  }
  const tokenHash = exactlyOneEventTag(tags, "d")?.toLowerCase();
  if (!tokenHash || !APPROVAL_HASH_PATTERN.test(tokenHash)) return null;
  const channelId = optionalSingleEventTag(tags, "h");
  const workflowId = optionalSingleEventTag(tags, "workflow");
  if (channelId === null || workflowId === null) return null;
  return {
    eventId: event.id,
    tokenHash,
    channelId: channelId?.toLowerCase() ?? null,
    workflowId:
      workflowId && isWorkflowUuid(workflowId)
        ? workflowId.toLowerCase()
        : null,
    content: event.content,
    createdAt: event.created_at,
  };
}

export type ManualWorkflowLimits = {
  remaining_workflow: number;
  remaining_community: number;
  next_eligible_at: string | null;
  server_now: string;
};
export type ManualWorkflowDecision = {
  accepted: boolean;
  run_id: string | null;
  reason: string | null;
  revision: number;
  limits: ManualWorkflowLimits;
};
export type ScheduledWorkflowRun = {
  id: string;
  execution_state:
    | "unknown"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "timed_out"
    | "stalled";
  origin: "manual" | "scheduled" | "event";
  requester: string | null;
  accepted_at: string | null;
  deadline_at: string | null;
  created_at: number;
  safe_error_code: string | null;
  revision: number;
  results: { channel_id: string; event_id: string }[];
};
export type AgentScheduledWorkflow = {
  workflow_id: string;
  name: string;
  definition_hash: string;
  agent_targets: string[];
  channel_id: string;
  schedule: Extract<WorkflowTrigger, { on: "schedule" }>;
  timezone: "UTC";
  next_scheduled_at: string | null;
  enabled: boolean;
  last_run: ScheduledWorkflowRun | null;
  limits: ManualWorkflowLimits;
  block_reason: string | null;
  revision: number;
};
export type AgentScheduledWorkflowPage = {
  workflows: AgentScheduledWorkflow[];
  next: string | null;
  server_now: string;
};

function summaryRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid workflow summary.");
  return value;
}
function summaryText(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Invalid workflow summary text.");
  return value;
}
function summaryOptionalText(value: unknown): string | null {
  return value === null ? null : summaryText(value);
}
function summaryUuid(value: unknown): string {
  const text = summaryText(value);
  if (!isWorkflowUuid(text) || text !== text.toLowerCase())
    throw new Error("Invalid workflow reference.");
  return text;
}
function summaryKey(value: unknown): string {
  const text = summaryText(value);
  if (!EVENT_ID_PATTERN.test(text)) throw new Error("Invalid workflow key.");
  return text;
}
function summaryInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid workflow count.");
  return value;
}
function summaryTime(value: unknown): string {
  const text = summaryText(value);
  if (!/^\d{4}-\d\d-\d\dT/.test(text) || !Number.isFinite(Date.parse(text)))
    throw new Error("Invalid workflow time.");
  return text;
}
function summaryOptionalTime(value: unknown): string | null {
  return value === null ? null : summaryTime(value);
}
function parseManualLimits(value: unknown): ManualWorkflowLimits {
  const limits = summaryRecord(value);
  const remaining_workflow = summaryInteger(limits.remaining_workflow);
  const remaining_community = summaryInteger(limits.remaining_community);
  if (remaining_workflow > 3 || remaining_community > 10)
    throw new Error("Invalid workflow allowance.");
  return {
    remaining_workflow,
    remaining_community,
    next_eligible_at: summaryOptionalTime(limits.next_eligible_at),
    server_now: summaryTime(limits.server_now),
  };
}
/** Parse only the structured relay admission receipt; acceptance is not completion. */
export function parseManualWorkflowDecision(
  value: unknown,
): ManualWorkflowDecision {
  const decision = summaryRecord(value);
  if (typeof decision.accepted !== "boolean")
    throw new Error("Missing workflow admission decision.");
  const run_id = decision.run_id === null ? null : summaryUuid(decision.run_id);
  const reason = summaryOptionalText(decision.reason);
  if (
    (decision.accepted && (!run_id || reason !== null)) ||
    (!decision.accepted && !reason)
  )
    throw new Error("Inconsistent workflow admission decision.");
  return {
    accepted: decision.accepted,
    run_id,
    reason,
    revision: summaryInteger(decision.revision),
    limits: parseManualLimits(decision.limits),
  };
}
function parseScheduledRun(value: unknown): ScheduledWorkflowRun {
  const run = summaryRecord(value);
  const execution_state = summaryText(run.execution_state);
  if (
    ![
      "unknown",
      "queued",
      "running",
      "completed",
      "failed",
      "timed_out",
      "stalled",
    ].includes(execution_state)
  )
    throw new Error("Unknown workflow state.");
  if (!["manual", "scheduled", "event"].includes(String(run.origin)))
    throw new Error("Unknown workflow origin.");
  if (!Array.isArray(run.results)) throw new Error("Invalid workflow results.");
  return {
    id: summaryUuid(run.id),
    execution_state: execution_state as ScheduledWorkflowRun["execution_state"],
    origin: run.origin as ScheduledWorkflowRun["origin"],
    requester: run.requester === null ? null : summaryKey(run.requester),
    accepted_at: summaryOptionalTime(run.accepted_at),
    deadline_at: summaryOptionalTime(run.deadline_at),
    created_at: summaryInteger(run.created_at),
    safe_error_code: summaryOptionalText(run.safe_error_code),
    revision: summaryInteger(run.revision),
    results: run.results.map((item) => {
      const result = summaryRecord(item);
      return {
        channel_id: summaryUuid(result.channel_id),
        event_id: summaryKey(result.event_id),
      };
    }),
  };
}
/** Validate the summary's safe fields without exposing detailed traces or provider text. */
export function parseAgentScheduledWorkflowPage(
  value: unknown,
): AgentScheduledWorkflowPage {
  const page = summaryRecord(value);
  if (!Array.isArray(page.workflows)) throw new Error("Invalid workflow list.");
  const workflows = page.workflows.map((value): AgentScheduledWorkflow => {
    const row = summaryRecord(value);
    // Relay DTOs serialize the unused schedule Option as null. Definition
    // validation stays strict; normalize only these two summary fields.
    const { cron, interval, ...trigger } = summaryRecord(row.schedule);
    const schedule = parseTrigger({
      ...trigger,
      ...(cron == null ? {} : { cron }),
      ...(interval == null ? {} : { interval }),
    });
    if (
      schedule.on !== "schedule" ||
      row.timezone !== "UTC" ||
      typeof row.enabled !== "boolean" ||
      !Array.isArray(row.agent_targets)
    )
      throw new Error("Invalid scheduled workflow.");
    const channel_id = summaryUuid(row.channel_id);
    const last_run =
      row.last_run === null ? null : parseScheduledRun(row.last_run);
    if (last_run?.results.some((result) => result.channel_id !== channel_id))
      throw new Error("Workflow result is outside its destination.");
    return {
      workflow_id: summaryUuid(row.workflow_id),
      name: summaryText(row.name),
      definition_hash: summaryKey(row.definition_hash),
      agent_targets: row.agent_targets.map(summaryKey),
      channel_id,
      schedule,
      timezone: "UTC",
      next_scheduled_at: summaryOptionalTime(row.next_scheduled_at),
      enabled: row.enabled,
      last_run,
      limits: parseManualLimits(row.limits),
      block_reason: summaryOptionalText(row.block_reason),
      revision: summaryInteger(row.revision),
    };
  });
  if (
    new Set(workflows.map((row) => row.workflow_id)).size !== workflows.length
  )
    throw new Error("Duplicate workflow summary.");
  return {
    workflows,
    next: page.next === null ? null : summaryUuid(page.next),
    server_now: summaryTime(page.server_now),
  };
}
/** A fresh user activation has its own event identity, even within the same second. */
export function manualWorkflowTriggerTemplate(
  workflowId: string,
  definitionHash: string,
  nonce: string,
) {
  return {
    kind: 46020,
    tags: [
      ["d", summaryUuid(workflowId)],
      ["request", summaryUuid(nonce)],
    ],
    content: JSON.stringify({
      expected_definition_hash: summaryKey(definitionHash),
    }),
  };
}
/** Construct only an internal, validated result route, never a server-supplied URL. */
export function workflowResultHref(channel: string, event: string): string {
  return `/?channel=${summaryUuid(channel)}&thread=${summaryKey(event)}`;
}
/** Stable safe explanations; unknown server codes keep activation disabled. */
export function manualWorkflowReason(reason: string): string {
  const reasons: Record<string, string> = {
    workflow_disabled: "This workflow is paused.",
    workflow_owner_required: "Only this workflow’s owner can run it.",
    association_unresolved: "The agent association needs an owner update.",
    unsupported_manual_profile:
      "This workflow does not support manual execution.",
    permission_revoked:
      "Current agent or channel permissions do not allow this run.",
    definition_changed: "The workflow changed. Refresh before running it.",
    workflow_cooldown: "The 15-minute cooldown is active.",
    workflow_daily_limit: "The workflow’s rolling 24-hour allowance is used.",
    community_daily_limit: "The workspace’s rolling 24-hour allowance is used.",
    workflow_active: "This workflow already has unfinished work.",
    agent_active_limit: "This agent already has an active manual run.",
    community_active_limit:
      "Two manual runs are already active in this workspace.",
    runner_unavailable: "The runner is not ready for supervised execution.",
    execution_failed: "The execution failed.",
    deadline_exceeded: "The execution deadline was reached.",
    legacy_execution_unknown: "Earlier work has not been confirmed stopped.",
  };
  return (
    reasons[reason] ??
    "The relay cannot allow this run yet. Refresh for current status."
  );
}
/** Server denial remains authoritative after its displayed countdown reaches zero. */
export function canRunScheduledWorkflow(row: AgentScheduledWorkflow): boolean {
  return (
    row.enabled &&
    row.block_reason === null &&
    row.limits.remaining_workflow > 0 &&
    row.limits.remaining_community > 0 &&
    !["queued", "running", "stalled"].includes(
      row.last_run?.execution_state ?? "",
    )
  );
}

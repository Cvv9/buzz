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
  | { action: "send_message"; text: string; channel?: string }
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
        ["id", "name", "if", "timeout_secs", "action", "text", "channel"],
        "step",
      );
      const channel = optionalString(step.channel, "step.channel");
      if (channel) workflowUuid(channel, "step.channel");
      return channel
        ? { action, text: string(step.text, "step.text"), channel }
        : { action, text: string(step.text, "step.text") };
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

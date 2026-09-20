import {
  type NostrEvent,
  publishEvent,
  publishEventWithReceipt,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { getUnlockedBrowserIdentity } from "@/shared/lib/browser-identity";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { verifyEvent } from "nostr-tools/pure";
import {
  isNewerWorkflowHead,
  type AgentScheduledWorkflowPage,
  type ManualWorkflowDecision,
  parseAgentScheduledWorkflowPage,
  parseManualWorkflowDecision,
  manualWorkflowTriggerTemplate,
  isWorkflowUuid,
  parseWorkflowApprovalRequestEvent,
  parseWorkflowDefinition,
  parseWorkflowDefinitionEvent,
  type WorkflowDefinition,
} from "./workflow-policy";

export const KIND_WORKFLOW_DEFINITION = 30620;
export const KIND_WORKFLOW_TRACE_START = 46001;
export const KIND_WORKFLOW_TRACE_STEP = 46002;
export const KIND_WORKFLOW_TRACE_COMPLETE = 46003;
export const KIND_WORKFLOW_TRACE_KINDS = [
  KIND_WORKFLOW_TRACE_START,
  KIND_WORKFLOW_TRACE_STEP,
  KIND_WORKFLOW_TRACE_COMPLETE,
  46004,
  46005,
  46006,
  46007,
] as const;
export const KIND_WORKFLOW_APPROVAL_REQUESTED = 46010;
export const KIND_WORKFLOW_TRIGGER = 46020;
export const KIND_WORKFLOW_APPROVAL_GRANT = 46030;
export const KIND_WORKFLOW_APPROVAL_DENY = 46031;

const APPROVAL_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export type BrowserWorkflow = {
  id: string;
  channelId: string;
  ownerPubkey: string;
  yaml: string;
  definition: WorkflowDefinition;
  createdAt: number;
  eventId: string;
};

export type WorkflowTraceEvent = {
  id: string;
  kind: number;
  createdAt: number;
  content: string;
  tags: string[][];
};

export type WorkflowApprovalRequest = {
  eventId: string;
  tokenHash: string;
  channelId: string | null;
  workflowId: string | null;
  content: string;
  createdAt: number;
};

export type WorkflowCommandReceipt = {
  event: NostrEvent;
  workflowId?: string;
  runId?: string;
  webhookSecret?: string;
};

function workflowFromEvent(event: NostrEvent): BrowserWorkflow | null {
  const parsed = parseWorkflowDefinitionEvent(event);
  if (!parsed) return null;
  return {
    id: parsed.workflowId,
    channelId: parsed.channelId,
    ownerPubkey: parsed.ownerPubkey,
    yaml: parsed.yaml,
    definition: parsed.definition,
    createdAt: parsed.createdAt,
    eventId: parsed.id,
  };
}

/** Keep the current NIP-33 head for each author/workflow coordinate. */
export function latestWorkflowHeads(events: NostrEvent[]): BrowserWorkflow[] {
  const latest = new Map<string, BrowserWorkflow>();
  for (const event of events) {
    const workflow = workflowFromEvent(event);
    if (!workflow) continue;
    const key = `${workflow.ownerPubkey}:${workflow.id}`;
    const current = latest.get(key);
    if (
      !current ||
      isNewerWorkflowHead(
        { id: workflow.eventId, created_at: workflow.createdAt },
        { id: current.eventId, created_at: current.createdAt },
      )
    ) {
      latest.set(key, workflow);
    }
  }
  return [...latest.values()].sort(
    (left, right) =>
      right.createdAt - left.createdAt ||
      left.eventId.localeCompare(right.eventId),
  );
}

function requireWorkflowId(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!isWorkflowUuid(normalized)) throw new Error(`${field} must be a UUID.`);
  return normalized;
}

function parseCommandResponse(message: string | null): Record<string, unknown> {
  if (!message?.startsWith("response:")) return {};
  try {
    const value: unknown = JSON.parse(message.slice("response:".length));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringResponse(
  response: Record<string, unknown>,
  key: "workflow_id" | "run_id" | "webhook_secret",
): string | undefined {
  const value = response[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function commandReceipt(
  event: NostrEvent,
  relayMessage: string | null,
): WorkflowCommandReceipt {
  const response = parseCommandResponse(relayMessage);
  return {
    event,
    workflowId: stringResponse(response, "workflow_id"),
    runId: stringResponse(response, "run_id"),
    webhookSecret: stringResponse(response, "webhook_secret"),
  };
}

export async function listChannelWorkflows(
  channelId: string,
): Promise<BrowserWorkflow[]> {
  const normalizedChannelId = requireWorkflowId(channelId, "Channel ID");
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_WORKFLOW_DEFINITION],
    "#h": [normalizedChannelId],
    limit: 500,
  });
  return latestWorkflowHeads(events).filter(
    (workflow) => workflow.channelId === normalizedChannelId,
  );
}

export async function getWorkflow(
  workflowId: string,
): Promise<BrowserWorkflow | null> {
  const normalizedWorkflowId = requireWorkflowId(workflowId, "Workflow ID");
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_WORKFLOW_DEFINITION],
    "#d": [normalizedWorkflowId],
    limit: 100,
  });
  return (
    latestWorkflowHeads(events).find(
      (workflow) => workflow.id === normalizedWorkflowId,
    ) ?? null
  );
}

export async function publishWorkflowDefinition(input: {
  channelId: string;
  yaml: string;
  workflowId?: string;
}): Promise<WorkflowCommandReceipt> {
  const channelId = requireWorkflowId(input.channelId, "Channel ID");
  const workflowId = input.workflowId
    ? requireWorkflowId(input.workflowId, "Workflow ID")
    : crypto.randomUUID();
  parseWorkflowDefinition(input.yaml);
  const published = await publishEventWithReceipt(relayWsUrl(), {
    kind: KIND_WORKFLOW_DEFINITION,
    content: input.yaml,
    tags: [
      ["d", workflowId],
      ["h", channelId],
    ],
  });
  return commandReceipt(published.event, published.relayMessage);
}

/** Delete an owned workflow through the relay's existing NIP-09 coordinate handler. */
export function deleteWorkflow(input: {
  workflowId: string;
  ownerPubkey: string;
}): Promise<NostrEvent> {
  const workflowId = requireWorkflowId(input.workflowId, "Workflow ID");
  const ownerPubkey = input.ownerPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) {
    throw new Error("Workflow owner must be a public key.");
  }
  return publishEvent(relayWsUrl(), {
    kind: 5,
    content: "",
    tags: [["a", `${KIND_WORKFLOW_DEFINITION}:${ownerPubkey}:${workflowId}`]],
  });
}

export async function triggerWorkflow(input: {
  workflowId: string;
  inputs?: Record<string, unknown>;
}): Promise<WorkflowCommandReceipt> {
  const workflowId = requireWorkflowId(input.workflowId, "Workflow ID");
  const inputs = input.inputs ?? {};
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
    throw new Error("Workflow inputs must be a JSON object.");
  }
  const published = await publishEventWithReceipt(relayWsUrl(), {
    kind: KIND_WORKFLOW_TRIGGER,
    content: JSON.stringify(inputs),
    tags: [["d", workflowId]],
  });
  return commandReceipt(published.event, published.relayMessage);
}

export async function actOnWorkflowApproval(input: {
  tokenHash: string;
  action: "grant" | "deny";
  note?: string;
}): Promise<NostrEvent> {
  const tokenHash = input.tokenHash.trim().toLowerCase();
  if (!APPROVAL_HASH_PATTERN.test(tokenHash)) {
    throw new Error("Approval token reference must be a SHA-256 hash.");
  }
  const note = input.note?.trim() ?? "";
  if (note.length > 4_000) throw new Error("Approval note is too long.");
  return publishEvent(relayWsUrl(), {
    kind:
      input.action === "grant"
        ? KIND_WORKFLOW_APPROVAL_GRANT
        : KIND_WORKFLOW_APPROVAL_DENY,
    content: note,
    tags: [["d", tokenHash]],
  });
}

export async function listWorkflowTrace(
  workflowId: string,
): Promise<WorkflowTraceEvent[]> {
  const normalizedWorkflowId = requireWorkflowId(workflowId, "Workflow ID");
  const events = await queryEvents(relayWsUrl(), {
    kinds: [...KIND_WORKFLOW_TRACE_KINDS],
    "#d": [normalizedWorkflowId],
    limit: 100,
  });
  return events
    .filter((event) => KIND_WORKFLOW_TRACE_KINDS.includes(event.kind as 46001))
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      createdAt: event.created_at,
      content: event.content,
      tags: event.tags,
    }))
    .sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    );
}

function approvalRequestFromEvent(
  event: NostrEvent,
  viewerPubkey: string,
): WorkflowApprovalRequest | null {
  return parseWorkflowApprovalRequestEvent(event, viewerPubkey);
}

export async function listWorkflowApprovalRequests(
  viewerPubkey: string,
): Promise<WorkflowApprovalRequest[]> {
  const pubkey = viewerPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return [];
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_WORKFLOW_APPROVAL_REQUESTED],
    "#p": [pubkey],
    limit: 100,
  });
  const latestByToken = new Map<string, WorkflowApprovalRequest>();
  for (const event of events) {
    const request = approvalRequestFromEvent(event, pubkey);
    if (!request) continue;
    const current = latestByToken.get(request.tokenHash);
    if (
      !current ||
      request.createdAt > current.createdAt ||
      (request.createdAt === current.createdAt &&
        request.eventId < current.eventId)
    ) {
      latestByToken.set(request.tokenHash, request);
    }
  }
  return [...latestByToken.values()].sort(
    (left, right) =>
      right.createdAt - left.createdAt ||
      left.eventId.localeCompare(right.eventId),
  );
}

export function subscribeToChannelWorkflows(
  channelId: string,
  onEvent: (event: NostrEvent) => void,
): () => void {
  const normalizedChannelId = requireWorkflowId(channelId, "Channel ID");
  return subscribeEvents(
    relayWsUrl(),
    { kinds: [KIND_WORKFLOW_DEFINITION], "#h": [normalizedChannelId] },
    onEvent,
  );
}

export function subscribeToWorkflow(
  workflowId: string,
  onEvent: (event: NostrEvent) => void,
): () => void {
  const normalizedWorkflowId = requireWorkflowId(workflowId, "Workflow ID");
  return subscribeEvents(
    relayWsUrl(),
    { kinds: [KIND_WORKFLOW_DEFINITION], "#d": [normalizedWorkflowId] },
    onEvent,
  );
}

export function subscribeToWorkflowTrace(
  workflowId: string,
  onEvent: (event: NostrEvent) => void,
): () => void {
  const normalizedWorkflowId = requireWorkflowId(workflowId, "Workflow ID");
  return subscribeEvents(
    relayWsUrl(),
    { kinds: [...KIND_WORKFLOW_TRACE_KINDS], "#d": [normalizedWorkflowId] },
    onEvent,
  );
}

export function subscribeToWorkflowApprovalRequests(
  viewerPubkey: string,
  onEvent: (event: NostrEvent) => void,
): () => void {
  const pubkey = viewerPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return () => undefined;
  return subscribeEvents(
    relayWsUrl(),
    { kinds: [KIND_WORKFLOW_APPROVAL_REQUESTED], "#p": [pubkey] },
    onEvent,
  );
}

/** Current browser/relay partition for an authorized settings request. */
export type WorkflowRequestScope = { viewerPubkey: string; relayBase: string };
export type PreparedManualWorkflowRequest = {
  event: NostrEvent;
  scope: WorkflowRequestScope;
};

function assertWorkflowScope(
  scope: WorkflowRequestScope,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    getUnlockedBrowserIdentity()?.pubkey !== scope.viewerPubkey ||
    relayHttpBaseUrl() !== scope.relayBase
  ) {
    throw new Error(
      "The account or workspace changed. Open its current settings again.",
    );
  }
  if (!navigator.onLine)
    throw new Error("You are offline. No workflow request was queued.");
}
async function workflowAuthorization(
  url: string,
  method: string,
  scope: WorkflowRequestScope,
  signal?: AbortSignal,
  body?: string,
) {
  assertWorkflowScope(scope, signal);
  const header = await makeNip98AuthHeader(url, method, {
    requireNip07: true,
    ...(body === undefined ? {} : { body }),
  });
  assertWorkflowScope(scope, signal);
  const signed = JSON.parse(atob(header.slice("Nostr ".length))) as NostrEvent;
  if (signed.pubkey !== scope.viewerPubkey || !verifyEvent(signed))
    throw new Error(
      "The signing account does not match this workspace session.",
    );
  return header;
}
/** Read only the owner-authorized, safe workflow summary projection. */
export async function listAgentScheduledWorkflows(
  scope: WorkflowRequestScope,
  agentPubkey: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<AgentScheduledWorkflowPage> {
  if (!/^[0-9a-f]{64}$/.test(agentPubkey))
    throw new Error("Invalid agent public key.");
  const url = new URL(`${scope.relayBase.replace(/\/+$/, "")}/workflows`);
  url.searchParams.set("agent_pubkey", agentPubkey);
  url.searchParams.set("limit", "50");
  if (cursor)
    url.searchParams.set("cursor", requireWorkflowId(cursor, "Cursor"));
  const authorization = await workflowAuthorization(
    url.href,
    "GET",
    scope,
    signal,
  );
  assertWorkflowScope(scope, signal);
  const response = await fetch(url.href, {
    headers: { Authorization: authorization, Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    cache: "no-store",
  });
  assertWorkflowScope(scope, signal);
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Only the current workspace owner with channel access can view these workflows."
        : "Could not load scheduled workflows. Try again.",
    );
  const value: unknown = await response.json();
  assertWorkflowScope(scope, signal);
  const page = parseAgentScheduledWorkflowPage(value);
  if (
    page.workflows.some(
      (row) =>
        row.agent_targets.length > 0 &&
        !row.agent_targets.includes(agentPubkey),
    )
  ) {
    throw new Error("The workflow summary does not match this agent.");
  }
  return page;
}
/** Prepare exactly one signed command; retries retain this envelope unchanged. */
export async function prepareManualWorkflowRequest(
  scope: WorkflowRequestScope,
  workflowId: string,
  definitionHash: string,
  signal: AbortSignal,
): Promise<PreparedManualWorkflowRequest> {
  assertWorkflowScope(scope, signal);
  const event = await signNostrEvent(
    manualWorkflowTriggerTemplate(
      workflowId,
      definitionHash,
      crypto.randomUUID(),
    ),
    { requireNip07: true },
  );
  assertWorkflowScope(scope, signal);
  if (event.pubkey !== scope.viewerPubkey || !verifyEvent(event))
    throw new Error(
      "The signing account does not match this workspace session.",
    );
  return { event, scope };
}
/** An acknowledgement may have been lost; retain the prepared request for an explicit retry. */
export class WorkflowRequestUncertainError extends Error {
  constructor() {
    super(
      "The relay did not confirm this request. Refresh its status or retry the same request.",
    );
  }
}
/** Submit through the existing Nostr bridge, with at most one same-event transport retry. */
export async function submitManualWorkflowRequest(
  prepared: PreparedManualWorkflowRequest,
  signal: AbortSignal,
): Promise<ManualWorkflowDecision> {
  const { event, scope } = prepared;
  const url = `${scope.relayBase.replace(/\/+$/, "")}/events`;
  const body = JSON.stringify(event);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authorization = await workflowAuthorization(
      url,
      "POST",
      scope,
      signal,
      body,
    );
    assertWorkflowScope(scope, signal);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      });
    } catch {
      assertWorkflowScope(scope, signal);
      if (attempt === 0) continue;
      throw new WorkflowRequestUncertainError();
    }
    assertWorkflowScope(scope, signal);
    if (response.status >= 500) {
      if (attempt === 0) continue;
      throw new WorkflowRequestUncertainError();
    }
    if (!response.ok)
      throw new Error(
        "The relay rejected this workflow request. Refresh permissions and status before trying again.",
      );
    const value: unknown = await response.json().catch(() => null);
    assertWorkflowScope(scope, signal);
    if (
      !value ||
      typeof value !== "object" ||
      !("message" in value) ||
      typeof value.message !== "string" ||
      !value.message.startsWith("response:") ||
      !("event_id" in value) ||
      value.event_id !== event.id
    )
      throw new WorkflowRequestUncertainError();
    try {
      const decision = parseManualWorkflowDecision(
        JSON.parse(value.message.slice("response:".length)),
      );
      if (!("accepted" in value) || value.accepted !== decision.accepted)
        throw new Error("Mismatched receipt.");
      return decision;
    } catch {
      throw new WorkflowRequestUncertainError();
    }
  }
  throw new WorkflowRequestUncertainError();
}

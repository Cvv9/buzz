import type {
  WorkspaceChannel,
  WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import { BROWSER_WORKFLOW_CAPABILITIES } from "./workflow-policy.ts";

export type WorkflowBuilderNodeKind =
  | "agent_task"
  | "web_search"
  | "library_tool"
  | "send_message"
  | "request_approval"
  | "call_webhook"
  | "delay";

const WEB_RESOURCE_PATTERN = /\b(web|browser|internet)\b/i;

/** Resource strings are runtime-published declarations, never browser guesses. */
export function publishedAgentResources(agent: WorkspaceProfile): string[] {
  return [
    ...new Set((agent.resources ?? []).map((resource) => resource.trim())),
  ]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export function agentSupportsWorkflowNode(
  agent: WorkspaceProfile,
  kind: WorkflowBuilderNodeKind,
): boolean {
  switch (kind) {
    case "agent_task":
      return true;
    case "web_search":
      return publishedAgentResources(agent).some((resource) =>
        WEB_RESOURCE_PATTERN.test(resource),
      );
    case "library_tool":
      return publishedAgentResources(agent).length > 0;
    case "request_approval":
      return BROWSER_WORKFLOW_CAPABILITIES.approvalRequests;
    default:
      return true;
  }
}

export function agentsForWorkflowNode(
  agents: readonly WorkspaceProfile[],
  kind: WorkflowBuilderNodeKind,
): WorkspaceProfile[] {
  return agents.filter((agent) => agentSupportsWorkflowNode(agent, kind));
}

export function workflowNodeUnavailableReason(
  kind: WorkflowBuilderNodeKind,
  agents: readonly WorkspaceProfile[],
): string | null {
  if (
    kind === "request_approval" &&
    !BROWSER_WORKFLOW_CAPABILITIES.approvalRequests
  ) {
    return "Approval requests are unavailable until the relay delivers them end-to-end.";
  }
  if (kind === "agent_task" && agents.length === 0) {
    return "No hosted agents are available in this community.";
  }
  if (kind === "web_search" && !agentsForWorkflowNode(agents, kind).length) {
    return "No hosted agent has published web access.";
  }
  if (kind === "library_tool" && !agentsForWorkflowNode(agents, kind).length) {
    return "No hosted agent has published a connected resource.";
  }
  return null;
}

/**
 * Prefer an explicit deep link, then the user's remembered workflow channel,
 * then the workspace's active channel. Falling back to the first result is a
 * last resort rather than an implicit alphabetical choice.
 */
export function selectWorkflowChannel(
  channels: readonly WorkspaceChannel[],
  candidates: readonly (string | null | undefined)[],
): string {
  for (const candidate of candidates) {
    if (candidate && channels.some((channel) => channel.id === candidate)) {
      return candidate;
    }
  }
  return channels[0]?.id ?? "";
}

export function workflowChannelStorageKey(
  viewerPubkey: string,
  relayUrl: string,
): string {
  return `buzz.web.workflow-channel:${relayUrl.toLowerCase()}:${viewerPubkey.toLowerCase()}`;
}

import type { NostrEvent } from "@/shared/lib/nostr-client";

function firstTag(
  event: Pick<NostrEvent, "tags">,
  name: string,
): string | null {
  const value = event.tags.find((tag) => tag[0] === name)?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type WorkflowMessagePresentation = {
  actorPubkey: string;
  workflowId: string;
  workflowName: string;
};

/** Resolve trusted relay-workflow presentation tags without changing authorship. */
export function workflowMessagePresentation(
  event: Pick<NostrEvent, "pubkey" | "tags">,
): WorkflowMessagePresentation | null {
  const workflowId = firstTag(event, "buzz:workflow");
  if (!workflowId) return null;
  return {
    actorPubkey: firstTag(event, "actor") ?? event.pubkey,
    workflowId,
    workflowName: firstTag(event, "workflow-name") ?? "Workflow automation",
  };
}

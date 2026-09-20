import type { PreparedManualWorkflow } from "@/shared/api/workflowTypes";

/** Deterministic server outcomes; this mock does not certify native signing. */
export type MockScheduledWorkflows = {
  rows: Record<string, unknown>[];
  ownerPubkey?: string;
  rowsByRelay?: Record<string, Record<string, unknown>[]>;
  pageSize?: number;
  readDelayMs?: number;
  readError?: boolean;
  prepareDelayMs?: number;
  submitDelayMs?: number;
  loseReceiptOnce?: boolean;
  denyReason?: string;
};
const receipts = new Map<string, unknown>();
const lost = new Set<string>();
const pause = (ms = 0) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export async function handleScheduledWorkflowCommand(
  command: string,
  payload: unknown,
  config: MockScheduledWorkflows | undefined,
  owner: string,
) {
  const args = payload as {
    agentPubkey: string;
    workflowId: string;
    definitionHash: string;
    cursor: string | null;
    scope: PreparedManualWorkflow["scope"];
    request: PreparedManualWorkflow;
  };
  const settings = config ?? { rows: [] };
  const scope =
    command === "submit_manual_workflow" ? args.request.scope : args.scope;
  const configuredRows =
    settings.rowsByRelay?.[scope.relay_url] ?? settings.rows;
  if (command === "get_agent_scheduled_workflows") {
    await pause(settings.readDelayMs);
    if (settings.readError || args.scope.owner_pubkey !== owner)
      throw new Error("Workflow summaries unavailable");
    const ownedRows =
      settings.ownerPubkey && settings.ownerPubkey !== owner
        ? []
        : configuredRows;
    const rows = ownedRows.filter((row) =>
      (row.agent_targets as string[]).includes(args.agentPubkey),
    );
    const offset = args.cursor
      ? rows.findIndex((row) => row.workflow_id === args.cursor) + 1
      : 0;
    const size = settings.pageSize ?? 20;
    const page = rows.slice(offset, offset + size);
    return {
      workflows: structuredClone(page),
      next: offset + size < rows.length ? page.at(-1)?.workflow_id : null,
      server_now: new Date().toISOString(),
    };
  }
  if (command === "prepare_manual_workflow") {
    await pause(settings.prepareDelayMs);
    if (args.scope.owner_pubkey !== owner)
      throw new Error("Workflow identity changed");
    const id = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    return {
      scope: args.scope,
      workflow_id: args.workflowId,
      definition_hash: args.definitionHash,
      event: {
        id,
        pubkey: owner,
        created_at: Math.floor(Date.now() / 1000),
        kind: 46020,
        tags: [
          ["d", args.workflowId],
          ["nonce", crypto.randomUUID()],
        ],
        content: JSON.stringify({
          expected_definition_hash: args.definitionHash,
        }),
        sig: "mock-signature",
      },
    };
  }
  await pause(settings.submitDelayMs);
  const request = args.request;
  if (request.scope.owner_pubkey !== owner)
    throw new Error("Workflow identity changed");
  const key = `${request.scope.relay_url}:${owner}:${request.event.id}`;
  if (!receipts.has(key)) {
    const row = configuredRows.find(
      (row) => row.workflow_id === request.workflow_id,
    );
    if (!row) throw new Error("Workflow missing");
    const reason =
      settings.denyReason ??
      (row.definition_hash !== request.definition_hash
        ? "definition_changed"
        : row.block_reason);
    const limits = structuredClone(row.limits) as Record<string, unknown>;
    const runId = crypto.randomUUID();
    if (!reason) {
      limits.remaining_workflow = Number(limits.remaining_workflow) - 1;
      limits.remaining_community = Number(limits.remaining_community) - 1;
      limits.server_now = new Date().toISOString();
      limits.next_eligible_at = new Date(Date.now() + 900_000).toISOString();
      row.limits = limits;
      row.block_reason = "workflow_active";
      row.last_run = {
        id: runId,
        execution_state: "queued",
        revision: 1,
        origin: "manual",
        accepted_at: new Date().toISOString(),
        results: [],
      };
    }
    receipts.set(key, {
      accepted: !reason,
      run_id: reason ? null : runId,
      reason: reason ?? null,
      revision: 1,
      limits,
    });
    if (settings.loseReceiptOnce && !lost.has(key)) {
      lost.add(key);
      throw new Error("Receipt lost after admission");
    }
  }
  return structuredClone(receipts.get(key));
}

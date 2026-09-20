import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fromAgentScheduledWorkflows,
  fromManualWorkflowReceipt,
  workflowTimestamp,
} from "../../shared/api/tauriWorkflows.ts";
import {
  MANUAL_WORKFLOW_COPY,
  manualWorkflowBlocked,
  manualWorkflowReason,
  safeWorkflowResult,
  scheduledWorkflowQueryKey,
  workflowScheduleLabel,
} from "./manualRunPolicy.ts";

const channel = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const limits = {
  remaining_workflow: 2,
  remaining_community: 9,
  next_eligible_at: "2026-09-20T01:15:00Z",
  server_now: "2026-09-20T01:00:00Z",
};
const raw = {
  workflow_id: "22222222-2222-2222-2222-222222222222",
  name: "Daily brief",
  definition_hash: "ab".repeat(32),
  agent_targets: ["cd".repeat(32)],
  channel_id: channel,
  schedule: { on: "schedule", cron: "0 9 * * *" },
  timezone: "UTC",
  next_scheduled_at: null,
  enabled: true,
  last_run: {
    id: "run",
    status: "completed",
    execution_state: "stalled",
    safe_error_code: "legacy_execution_unknown",
    revision: 2,
    started_at: 100,
    results: [],
    execution_trace: [{ secret: "sentinel" }],
    error_message: "sentinel",
  },
  limits,
  block_reason: "workflow_active",
  revision: 2,
};
const decode = (row = raw) =>
  fromAgentScheduledWorkflows({
    workflows: [row],
    next: null,
    server_now: limits.server_now,
  }).workflows[0];

test("actual outcome wins over dispatch completion and summary drops raw diagnostics", () => {
  const row = decode();
  assert.equal(row.lastRun.executionState, "stalled");
  assert.equal(row.lastRun.startedAt, 100_000);
  assert.equal(JSON.stringify(row).includes("sentinel"), false);
  assert.equal(
    decode({
      ...raw,
      last_run: { ...raw.last_run, execution_state: undefined },
    }).lastRun.executionState,
    "unknown",
  );
});
test("authoritative clocks normalize ISO and legacy seconds without inventing missing times", () => {
  assert.equal(
    workflowTimestamp(limits.server_now),
    Date.parse(limits.server_now),
  );
  assert.equal(workflowTimestamp(null), null);
  assert.throws(() => workflowTimestamp("not a date"));
  assert.equal(decode().nextScheduledAt, null);
});
test("time passing never clears server block and fixed copy cannot leak error strings", () => {
  const row = decode();
  row.limits.nextEligibleAt = 0;
  assert.ok(manualWorkflowBlocked(row));
  assert.match(manualWorkflowReason("provider-secret-sentinel"), /unavailable/);
  assert.equal(
    manualWorkflowReason("provider-secret-sentinel").includes("sentinel"),
    false,
  );
  assert.match(manualWorkflowBlocked({ ...row, enabled: false }), /paused/);
  assert.match(MANUAL_WORKFLOW_COPY, /not a spending cap/);
  assert.match(MANUAL_WORKFLOW_COPY, /configured provider and fallback/);
});
test("signed-command denial preserves remaining allowance and never fabricates a run", () => {
  const rejected = fromManualWorkflowReceipt({
    accepted: false,
    run_id: null,
    reason: "workflow_daily_limit",
    revision: 0,
    limits,
  });
  assert.equal(rejected.runId, null);
  assert.equal(rejected.limits.remainingWorkflow, 2);
  assert.throws(() =>
    fromManualWorkflowReceipt({ accepted: true, run_id: null, limits }),
  );
  assert.throws(() =>
    fromManualWorkflowReceipt({
      accepted: false,
      reason: "x",
      revision: 0,
      limits: { ...limits, remaining_workflow: -1 },
    }),
  );
});
test("query identity includes community, relay, owner and agent", () => {
  const key = scheduledWorkflowQueryKey(
    "community",
    "wss://relay",
    "owner",
    "agent",
  );
  for (let i = 0; i < 4; i++) {
    const args = ["community", "wss://relay", "owner", "agent"];
    args[i] += "-new";
    assert.notDeepEqual(scheduledWorkflowQueryKey(...args), key);
  }
});
test("result navigation accepts only same-channel ids and never a server URL", () => {
  const result = {
    channelId: channel,
    eventId: "ab".repeat(32),
    taskId: "task",
    url: "https://attacker.test",
  };
  assert.deepEqual(safeWorkflowResult(channel, result), {
    channelId: channel,
    messageId: result.eventId,
  });
  assert.equal(safeWorkflowResult("other", result), null);
  assert.equal(
    safeWorkflowResult(channel, { ...result, eventId: "javascript:alert(1)" }),
    null,
  );
  assert.equal(
    safeWorkflowResult(channel, {
      ...result,
      channelId: "00000000-0000-0000-0000-000000000000",
    }),
    null,
  );
  assert.equal(workflowScheduleLabel({ interval: "1h" }), "Every 1h");
});

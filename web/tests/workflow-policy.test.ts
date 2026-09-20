import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewerWorkflowHead,
  parseAgentScheduledWorkflowPage,
  parseManualWorkflowDecision,
  manualWorkflowTriggerTemplate,
  workflowResultHref,
  canRunScheduledWorkflow,
  manualWorkflowReason,
  parseWorkflowApprovalRequestEvent,
  parseWorkflowDefinition,
  parseWorkflowDefinitionEvent,
  setWorkflowDefinitionEnabled,
  validateBrowserWorkflowPublication,
} from "../src/features/workflows/workflow-policy.ts";
import {
  agentSupportsWorkflowNode,
  agentsForWorkflowNode,
  publishedAgentResources,
  selectWorkflowChannel,
  workflowChannelStorageKey,
} from "../src/features/workflows/workflow-builder-policy.ts";

const AUTHOR = "a".repeat(64);
const VIEWER = "b".repeat(64);
const OTHER_VIEWER = "c".repeat(64);
const EVENT_ID = "d".repeat(64);
const WORKFLOW_ID = "2f97064d-2b57-4e6d-a6a0-3a1ac47b4c20";
const CHANNEL_ID = "1f97064d-2b57-4e6d-a6a0-3a1ac47b4c20";
const YAML = `name: Incident alert
trigger:
  on: message_posted
steps:
  - id: notify
    action: send_message
    text: "Alert the channel"
`;

function event(input: Partial<Record<string, unknown>> = {}) {
  return {
    id: EVENT_ID,
    pubkey: AUTHOR,
    kind: 30620,
    created_at: 100,
    content: YAML,
    tags: [
      ["d", WORKFLOW_ID],
      ["h", CHANNEL_ID],
    ],
    ...input,
  };
}

test("workflow YAML schema is strict and the portable enabled flag round-trips", () => {
  const parsed = parseWorkflowDefinition(YAML);
  assert.equal(parsed.name, "Incident alert");
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.steps[0]?.action, "send_message");

  const disabled = setWorkflowDefinitionEnabled(YAML, false);
  assert.equal(parseWorkflowDefinition(disabled).enabled, false);
  assert.throws(
    () =>
      parseWorkflowDefinition(
        `${YAML}\nunknown_protocol_extension: not-supported`,
      ),
    /not supported/,
  );
});

test("Buzz Web refuses to publish an approval gate until relay delivery exists", () => {
  const approvalYaml = `name: Approval gate
trigger:
  on: message_posted
steps:
  - id: request
    action: request_approval
    from: "@owner"
    message: "Approve this change"
`;
  assert.equal(
    parseWorkflowDefinition(approvalYaml).steps[0]?.action,
    "request_approval",
    "the canonical parser must retain readable historical definitions",
  );
  assert.throws(
    () => validateBrowserWorkflowPublication(approvalYaml),
    /does not yet deliver approval requests end-to-end/,
  );
  assert.equal(validateBrowserWorkflowPublication(YAML).name, "Incident alert");
});

test("workflow agent nodes use only runtime-published resources", () => {
  const webAgent = {
    pubkey: "1".repeat(64),
    name: "Scout",
    resources: [
      "Public web sources",
      "Company knowledge",
      "Public web sources",
    ],
  };
  const internalAgent = {
    pubkey: "2".repeat(64),
    name: "Operator",
    resources: ["Internal runbook"],
  };
  const unprovisionedAgent = {
    pubkey: "3".repeat(64),
    name: "Generalist",
  };

  assert.deepEqual(publishedAgentResources(webAgent), [
    "Company knowledge",
    "Public web sources",
  ]);
  assert.equal(agentSupportsWorkflowNode(webAgent, "web_search"), true);
  assert.equal(agentSupportsWorkflowNode(internalAgent, "web_search"), false);
  assert.equal(agentSupportsWorkflowNode(internalAgent, "library_tool"), true);
  assert.equal(
    agentSupportsWorkflowNode(unprovisionedAgent, "library_tool"),
    false,
  );
  assert.deepEqual(
    agentsForWorkflowNode(
      [webAgent, internalAgent, unprovisionedAgent],
      "web_search",
    ).map((agent) => agent.name),
    ["Scout"],
  );
});

test("workflow channel selection prefers explicit, remembered, then active context", () => {
  const channels = ["first", "active", "remembered"].map((id) => ({
    id,
    name: id,
    about: "",
    topic: "",
    type: "stream" as const,
    visibility: "public" as const,
    role: "member",
    memberPubkeys: [],
    catalogSection: "",
  }));
  assert.equal(
    selectWorkflowChannel(channels, ["active", "remembered", "first"]),
    "active",
  );
  assert.equal(
    selectWorkflowChannel(channels, ["missing", "remembered", "active"]),
    "remembered",
  );
  assert.equal(selectWorkflowChannel(channels, ["missing"]), "first");
  assert.notEqual(
    workflowChannelStorageKey(AUTHOR, "wss://one.example"),
    workflowChannelStorageKey(AUTHOR, "wss://two.example"),
  );
});

test("workflow definition projection rejects malformed or ambiguous relay envelopes", () => {
  const parsed = parseWorkflowDefinitionEvent(event());
  assert.equal(parsed?.workflowId, WORKFLOW_ID);
  assert.equal(parsed?.channelId, CHANNEL_ID);
  assert.equal(parsed?.ownerPubkey, AUTHOR);

  assert.equal(
    parseWorkflowDefinitionEvent(
      event({
        tags: [
          ["d", WORKFLOW_ID],
          ["h", CHANNEL_ID],
          ["h", CHANNEL_ID],
        ],
      }),
    ),
    null,
    "duplicate channel tags cannot select an ambiguous workflow coordinate",
  );
  assert.equal(
    parseWorkflowDefinitionEvent(event({ pubkey: AUTHOR.toUpperCase() })),
    null,
    "authors must use canonical lowercase hex",
  );
  assert.equal(
    parseWorkflowDefinitionEvent(event({ content: "name: incomplete" })),
    null,
    "invalid YAML is never projected from an untrusted relay event",
  );
});

test("workflow approval projection requires the active viewer p tag and a unique token hash", () => {
  const approval = event({
    kind: 46010,
    tags: [
      ["d", "e".repeat(64)],
      ["p", VIEWER],
    ],
    content: "Approve deployment?",
  });
  assert.equal(
    parseWorkflowApprovalRequestEvent(approval, VIEWER)?.tokenHash,
    "e".repeat(64),
  );
  assert.equal(
    parseWorkflowApprovalRequestEvent(approval, OTHER_VIEWER),
    null,
    "a relay filter result is not trusted without a local viewer tag check",
  );
  assert.equal(
    parseWorkflowApprovalRequestEvent(
      event({
        kind: 46010,
        tags: [
          ["d", "e".repeat(64)],
          ["d", "f".repeat(64)],
          ["p", VIEWER],
        ],
      }),
      VIEWER,
    ),
    null,
    "duplicate approval references are rejected",
  );
});

test("workflow replacement heads use NIP-16 lowest event id tie-break", () => {
  assert.equal(
    isNewerWorkflowHead(
      { created_at: 100, id: "a" },
      { created_at: 100, id: "b" },
    ),
    true,
  );
  assert.equal(
    isNewerWorkflowHead(
      { created_at: 100, id: "b" },
      { created_at: 100, id: "a" },
    ),
    false,
  );
});

test("explicit immutable agent bindings survive YAML parsing and enabled edits", () => {
  const yaml = `${YAML}    agent_targets: [${VIEWER}, ${OTHER_VIEWER}]\n`;
  const parsed = parseWorkflowDefinition(yaml);
  assert.deepEqual(
    parsed.steps[0]?.action === "send_message"
      ? parsed.steps[0].agent_targets
      : null,
    [VIEWER, OTHER_VIEWER],
  );
  assert.match(setWorkflowDefinitionEnabled(yaml, false), new RegExp(VIEWER));
  const unbound = parseWorkflowDefinition(`${YAML}    agent_targets: []\n`);
  assert.deepEqual(
    unbound.steps[0]?.action === "send_message"
      ? unbound.steps[0].agent_targets
      : null,
    [],
  );
  for (const targets of [
    `[${VIEWER}, ${VIEWER}]`,
    "[display-name]",
    `[${VIEWER.toUpperCase()}]`,
  ]) {
    assert.throws(() =>
      parseWorkflowDefinition(`${YAML}    agent_targets: ${targets}\n`),
    );
  }
});

const SUMMARY_NOW = "2026-09-20T06:00:00Z";
function scheduledSummary(overrides: Record<string, unknown> = {}) {
  return {
    workflow_id: WORKFLOW_ID,
    name: "Morning brief",
    definition_hash: EVENT_ID,
    agent_targets: [VIEWER],
    channel_id: CHANNEL_ID,
    schedule: { on: "schedule", interval: "24h", cron: null },
    timezone: "UTC",
    next_scheduled_at: null,
    enabled: true,
    last_run: null,
    block_reason: null,
    revision: 0,
    limits: {
      remaining_workflow: 3,
      remaining_community: 10,
      next_eligible_at: null,
      server_now: SUMMARY_NOW,
    },
    ...overrides,
  };
}
function summaryPage(row = scheduledSummary()) {
  return { workflows: [row], next: null, server_now: SUMMARY_NOW };
}

test("scheduled summaries preserve actual unknown evidence and strip unsafe historical fields", () => {
  const row = scheduledSummary({
    last_run: {
      id: WORKFLOW_ID,
      execution_state: "unknown",
      origin: "scheduled",
      requester: null,
      accepted_at: null,
      deadline_at: null,
      created_at: 10,
      safe_error_code: null,
      revision: 0,
      results: [],
      status: "completed",
      execution_trace: "PRIVATE_TRACE",
      error_message: "PROVIDER_SECRET",
    },
  });
  const result = parseAgentScheduledWorkflowPage(summaryPage(row));
  assert.equal(result.workflows[0]?.last_run?.execution_state, "unknown");
  assert.equal(result.workflows[0]?.next_scheduled_at, null);
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE_TRACE|PROVIDER_SECRET|completed/,
  );
  assert.throws(() =>
    parseAgentScheduledWorkflowPage({
      ...summaryPage(row),
      workflows: [row, row],
    }),
  );
  assert.throws(() =>
    parseAgentScheduledWorkflowPage(
      summaryPage(scheduledSummary({ definition_hash: "bad", enabled: true })),
    ),
  );
  assert.throws(() =>
    parseAgentScheduledWorkflowPage(
      summaryPage(scheduledSummary({ limits: { remaining_workflow: 99 } })),
    ),
  );
});

test("result links require valid same-destination references and ignore supplied URLs", () => {
  const last = {
    id: WORKFLOW_ID,
    execution_state: "completed",
    origin: "manual",
    requester: VIEWER,
    accepted_at: SUMMARY_NOW,
    deadline_at: SUMMARY_NOW,
    created_at: 10,
    safe_error_code: null,
    revision: 2,
    results: [
      {
        channel_id: CHANNEL_ID,
        event_id: EVENT_ID,
        url: "javascript:alert(1)",
      },
    ],
  };
  const parsed = parseAgentScheduledWorkflowPage(
    summaryPage(scheduledSummary({ last_run: last })),
  );
  const result = parsed.workflows[0]?.last_run?.results[0];
  assert.ok(result);
  assert.equal(
    workflowResultHref(result.channel_id, result.event_id),
    `/?channel=${CHANNEL_ID}&thread=${EVENT_ID}`,
  );
  assert.throws(() => workflowResultHref(CHANNEL_ID, "javascript:alert(1)"));
  assert.throws(() =>
    parseAgentScheduledWorkflowPage(
      summaryPage(
        scheduledSummary({
          last_run: {
            ...last,
            results: [{ channel_id: WORKFLOW_ID, event_id: EVENT_ID }],
          },
        }),
      ),
    ),
  );
});

test("manual command content has only expected hash and a distinct request tag", () => {
  const first = manualWorkflowTriggerTemplate(
    WORKFLOW_ID,
    EVENT_ID,
    CHANNEL_ID,
  );
  const second = manualWorkflowTriggerTemplate(
    WORKFLOW_ID,
    EVENT_ID,
    WORKFLOW_ID,
  );
  assert.deepEqual(JSON.parse(first.content), {
    expected_definition_hash: EVENT_ID,
  });
  assert.deepEqual(first.tags, [
    ["d", WORKFLOW_ID],
    ["request", CHANNEL_ID],
  ]);
  assert.notDeepEqual(first.tags, second.tags);
  assert.throws(() =>
    manualWorkflowTriggerTemplate(WORKFLOW_ID, "bad", CHANNEL_ID),
  );
});

test("accepted and rejected decisions remain typed; malformed admission is never success", () => {
  const limits = scheduledSummary().limits;
  assert.equal(
    parseManualWorkflowDecision({
      accepted: true,
      run_id: WORKFLOW_ID,
      reason: null,
      revision: 1,
      limits,
    }).accepted,
    true,
  );
  assert.equal(
    parseManualWorkflowDecision({
      accepted: false,
      run_id: null,
      reason: "workflow_cooldown",
      revision: 0,
      limits,
    }).reason,
    "workflow_cooldown",
  );
  assert.throws(() =>
    parseManualWorkflowDecision({
      accepted: true,
      run_id: null,
      reason: null,
      revision: 1,
      limits,
    }),
  );
  assert.throws(() =>
    parseManualWorkflowDecision({
      accepted: "true",
      run_id: WORKFLOW_ID,
      reason: null,
      revision: 1,
      limits,
    }),
  );
  assert.throws(() =>
    parseManualWorkflowDecision({
      accepted: false,
      run_id: null,
      reason: null,
      revision: 1,
      limits,
    }),
  );
});

test("elapsed cooldown never unlocks a row locally and unknown reasons stay disabled", () => {
  const ready = parseAgentScheduledWorkflowPage(summaryPage()).workflows[0];
  assert.ok(ready);
  assert.equal(canRunScheduledWorkflow(ready), true);
  assert.equal(
    canRunScheduledWorkflow({
      ...ready,
      block_reason: "workflow_cooldown",
      limits: { ...ready.limits, next_eligible_at: "2000-01-01T00:00:00Z" },
    }),
    false,
  );
  assert.equal(
    canRunScheduledWorkflow({ ...ready, block_reason: "new_server_reason" }),
    false,
  );
  assert.equal(canRunScheduledWorkflow({ ...ready, enabled: false }), false);
  assert.equal(
    canRunScheduledWorkflow({
      ...ready,
      limits: { ...ready.limits, remaining_workflow: 0 },
    }),
    false,
  );
  assert.match(manualWorkflowReason("workflow_cooldown"), /cooldown/);
  assert.doesNotMatch(
    manualWorkflowReason("arbitrary_provider_secret"),
    /arbitrary_provider_secret/,
  );
});

test("summary DTO accepts Rust null schedule options without loosening YAML definitions", () => {
  const interval = parseAgentScheduledWorkflowPage(
    summaryPage(
      scheduledSummary({
        schedule: { on: "schedule", cron: null, interval: "24h" },
      }),
    ),
  );
  assert.deepEqual(interval.workflows[0]?.schedule, {
    on: "schedule",
    interval: "24h",
  });
  const cron = parseAgentScheduledWorkflowPage(
    summaryPage(
      scheduledSummary({
        schedule: { on: "schedule", cron: "0 0 9 * * *", interval: null },
      }),
    ),
  );
  assert.deepEqual(cron.workflows[0]?.schedule, {
    on: "schedule",
    cron: "0 0 9 * * *",
  });
  assert.throws(() =>
    parseAgentScheduledWorkflowPage(
      summaryPage(
        scheduledSummary({
          schedule: { on: "schedule", cron: null, interval: null },
        }),
      ),
    ),
  );
  assert.throws(() =>
    parseWorkflowDefinition(
      YAML.replace(
        "  on: message_posted",
        "  on: schedule\n  cron: null\n  interval: 24h",
      ),
    ),
  );
});

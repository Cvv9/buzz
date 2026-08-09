import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewerWorkflowHead,
  parseWorkflowApprovalRequestEvent,
  parseWorkflowDefinition,
  parseWorkflowDefinitionEvent,
  setWorkflowDefinitionEnabled,
} from "../src/features/workflows/workflow-policy.ts";

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

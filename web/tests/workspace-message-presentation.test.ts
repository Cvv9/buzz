import assert from "node:assert/strict";
import test from "node:test";
import { workflowMessagePresentation } from "../src/features/workspace/workspace-message-presentation.ts";

test("workflow messages use trusted workflow metadata without changing the signer", () => {
  const relayPubkey = "7".repeat(64);
  const actorPubkey = "a".repeat(64);
  assert.deepEqual(
    workflowMessagePresentation({
      pubkey: relayPubkey,
      tags: [
        ["actor", actorPubkey],
        ["buzz:workflow", "2ecf7254-bde5-4e17-a392-86ca2d00e82d"],
        ["workflow-name", "Daily market intelligence"],
      ],
    }),
    {
      actorPubkey,
      workflowId: "2ecf7254-bde5-4e17-a392-86ca2d00e82d",
      workflowName: "Daily market intelligence",
    },
  );
});

test("legacy workflow messages receive a stable automation label", () => {
  const relayPubkey = "7".repeat(64);
  assert.deepEqual(
    workflowMessagePresentation({
      pubkey: relayPubkey,
      tags: [["buzz:workflow", "true"]],
    }),
    {
      actorPubkey: relayPubkey,
      workflowId: "true",
      workflowName: "Workflow automation",
    },
  );
});

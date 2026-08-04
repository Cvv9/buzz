import assert from "node:assert/strict";
import test from "node:test";

import {
  inboxDismissContextId,
  isTargetedApprovalRequest,
} from "../src/features/workspace/workspace-inbox-policy.mjs";

const viewer = "a".repeat(64);

test("only a pending approval request addressed to the viewer enters Inbox", () => {
  assert.equal(
    isTargetedApprovalRequest(
      { kind: 46010, tags: [["p", viewer.toUpperCase()]] },
      viewer,
    ),
    true,
  );
  assert.equal(
    isTargetedApprovalRequest({ kind: 46010, tags: [] }, viewer),
    false,
  );
  assert.equal(
    isTargetedApprovalRequest(
      { kind: 46010, tags: [["p", "b".repeat(64)]] },
      viewer,
    ),
    false,
  );
});

test("mentions, terminal decisions, and approval-like prose stay out", () => {
  for (const event of [
    { kind: 9, tags: [["p", viewer]], content: "@Varun" },
    { kind: 9, tags: [], content: "waiting for your approval" },
    { kind: 46011, tags: [["p", viewer]], content: "granted" },
    { kind: 46012, tags: [["p", viewer]], content: "denied" },
  ]) {
    assert.equal(isTargetedApprovalRequest(event, viewer), false);
  }
});

test("dismiss markers are per approval event", () => {
  assert.equal(inboxDismissContextId("event-1"), "inbox-dismiss:event-1");
});

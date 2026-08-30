import assert from "node:assert/strict";
import test from "node:test";
import { workspaceInvalidationTargets } from "../src/features/workspace/workspace-realtime-sync-policy.ts";

const VIEWER = "a".repeat(64);

test("channel catalog heads invalidate the channel query immediately", () => {
  assert.deepEqual(
    workspaceInvalidationTargets({ kind: 39000, tags: [] }, VIEWER),
    ["channels"],
  );
  assert.deepEqual(
    workspaceInvalidationTargets({ kind: 39002, tags: [] }, VIEWER),
    ["channels"],
  );
});

test("directory and authorized hosted config heads invalidate the agent query", () => {
  for (const kind of [10100, 30177, 30180, 30181]) {
    assert.deepEqual(workspaceInvalidationTargets({ kind, tags: [] }, VIEWER), [
      "agents",
    ]);
  }
});

test("membership notifications only refresh the addressed viewer", () => {
  assert.deepEqual(
    workspaceInvalidationTargets(
      { kind: 44100, tags: [["p", VIEWER]] },
      VIEWER,
    ),
    ["channels"],
  );
  assert.deepEqual(
    workspaceInvalidationTargets(
      { kind: 44101, tags: [["p", "b".repeat(64)]] },
      VIEWER,
    ),
    [],
  );
  assert.deepEqual(
    workspaceInvalidationTargets({ kind: 13534, tags: [] }, VIEWER),
    ["channels", "agents"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { shouldMountWorkspaceTheme } from "../src/features/workspace/workspace-theme-mount-policy.ts";

test("authenticated workspace mounts its theme before any channel exists", () => {
  assert.equal(shouldMountWorkspaceTheme("viewer-pubkey"), true);
  assert.equal(shouldMountWorkspaceTheme(""), false);
  assert.equal(shouldMountWorkspaceTheme(null), false);
});

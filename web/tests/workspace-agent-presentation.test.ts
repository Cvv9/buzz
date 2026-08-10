import assert from "node:assert/strict";
import test from "node:test";
import { agentRoleLabel } from "../src/features/workspace/agent-presentation.ts";

const pubkey = "a".repeat(64);

test("agent responsibility text replaces the stale Io compatibility alias", () => {
  assert.equal(
    agentRoleLabel({
      pubkey,
      name: "Lanaya",
      aliases: ["Io"],
      about: "Personal assistant. Daily planning and reminders.",
      accessTier: "personal",
    }),
    "Personal assistant",
  );
});

test("agent alias remains a fallback when the runtime has no summary", () => {
  assert.equal(
    agentRoleLabel({
      pubkey,
      name: "Oracle",
      aliases: ["Project Brain"],
      accessTier: "shared",
    }),
    "Project Brain",
  );
});

test("a concise role alias wins over a sentence-like summary", () => {
  assert.equal(
    agentRoleLabel({
      pubkey,
      name: "Oracle",
      aliases: ["Project Brain"],
      about: "Read-only source-backed knowledge about projects and risks.",
      accessTier: "shared",
    }),
    "Project Brain",
  );
});

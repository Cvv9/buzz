import assert from "node:assert/strict";
import test from "node:test";
import { compareWorkspaceChannels } from "../src/features/workspace/channel-order.ts";

test("team conversation precedes private decisions and preserves future rooms", () => {
  const input = [
    { name: "agent-lab", catalogSection: "Command Center" },
    { name: "new-room", catalogSection: "Future Project" },
    { name: "operations", catalogSection: "Command Center" },
    { name: "market-intelligence", catalogSection: "General" },
    { name: "general", catalogSection: "" },
    { name: "sylars-control", catalogSection: "Command Center" },
    { name: "brief-varun", catalogSection: "Command Center" },
    { name: "team-introductions", catalogSection: "GENERAL" },
  ];
  assert.deepEqual(
    [...input].sort(compareWorkspaceChannels).map((c) => c.name),
    [
      "general",
      "team-introductions",
      "market-intelligence",
      "brief-varun",
      "sylars-control",
      "operations",
      "agent-lab",
      "new-room",
    ],
  );
  assert.equal(input[0].name, "agent-lab");
});

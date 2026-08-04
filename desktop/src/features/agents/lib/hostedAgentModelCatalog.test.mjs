import assert from "node:assert/strict";
import test from "node:test";

import { hostedAgentModelGroups } from "./hostedAgentModelCatalog.ts";

test("keeps Claude Code and Codex choices when the hosted catalog is empty", () => {
  const groups = hostedAgentModelGroups([]);

  assert.deepEqual(
    groups.map((group) => [
      group.label,
      group.options.map((option) => option.name),
    ]),
    [
      ["Claude Code", ["Opus", "Fable"]],
      ["Codex", ["Sol", "Luna", "Terra"]],
    ],
  );
});

test("merges live models into their provider group without duplicates", () => {
  const groups = hostedAgentModelGroups([
    {
      id: "gpt-5.6-sol",
      name: "Sol (live)",
      description: "Runtime-advertised",
    },
    { id: "claude-sonnet-4-6", name: "Sonnet", description: null },
    { id: "private-model", name: "Private", description: null },
  ]);

  assert.equal(
    groups
      .find((group) => group.label === "Codex")
      ?.options.find((option) => option.id === "gpt-5.6-sol")?.name,
    "Sol (live)",
  );
  assert.ok(
    groups
      .find((group) => group.label === "Claude Code")
      ?.options.some((option) => option.name === "Sonnet"),
  );
  assert.deepEqual(
    groups.find((group) => group.label === "Agent-reported models")?.options,
    [{ id: "private-model", name: "Private", description: null }],
  );
});

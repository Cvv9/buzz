import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFleetAgent,
  currentFleetAction,
  filterAndSortFleetAgents,
  fleetUsageSummary,
  localMidnightBoundaries,
  msUntilNextLocalMidnight,
  safeRuntimeAttentionReason,
} from "./agentFleet.ts";

const CANDIDATE = {
  pubkey: "a".repeat(64),
  name: "Atlas",
  avatarUrl: null,
  configuredModel: null,
  source: "managed",
  runtime: "idle",
  hasRuntimeError: false,
  attentionReason: null,
};

const EMPTY_USAGE = {
  inputTokens: { value: null, incomplete: false },
  outputTokens: { value: null, incomplete: false },
  totalTokens: { value: null, incomplete: false },
  estimatedCostUsd: { value: null, incomplete: false },
  cacheReadTokens: { value: null, incomplete: false },
  cacheWriteTokens: { value: null, incomplete: false },
  freshInputTokens: { value: null, incomplete: false },
};

test("fleet current action exposes only a descriptor label, never tool arguments", () => {
  const action = currentFleetAction(
    [
      {
        id: "tool-1",
        type: "tool",
        renderClass: "shell",
        descriptor: {
          renderClass: "shell",
          label: "Running command",
          preview: "secret command argument",
        },
        title: "secret command argument",
        toolName: "shell",
        buzzToolName: null,
        status: "executing",
        args: { command: "cat .env" },
        result: "API_KEY=not-for-the-fleet",
        isError: false,
        timestamp: "2026-08-11T08:00:00.000Z",
        startedAt: "2026-08-11T08:00:00.000Z",
        completedAt: null,
        turnId: "turn-1",
      },
    ],
    [
      {
        turnId: "turn-1",
        channelId: "private-channel",
        anchorAt: 1,
        lastActivityAt: 2,
      },
    ],
  );

  assert.equal(action, "Running command");
  assert.doesNotMatch(action, /env|secret|cat/i);
});

test("fleet names a missing safe action label instead of repeating its status", () => {
  assert.equal(
    currentFleetAction(
      [],
      [
        {
          turnId: "turn-1",
          channelId: "private-channel",
          anchorAt: 1,
          lastActivityAt: 2,
        },
      ],
    ),
    "Activity details unavailable",
  );
});

test("fleet marks an unresolved observer failure as needing attention", () => {
  const agent = buildFleetAgent({
    candidate: CANDIDATE,
    activeTurns: [],
    events: [
      {
        seq: 1,
        timestamp: "2026-08-11T08:00:00.000Z",
        kind: "turn_error",
        agentIndex: null,
        channelId: null,
        sessionId: null,
        turnId: "turn-1",
        payload: { message: "private failure details" },
      },
    ],
    transcript: [],
    usage: undefined,
  });

  assert.equal(agent.status, "needs-attention");
  assert.equal(agent.currentAction, "Agent run failed");
  assert.equal(agent.lastActivityAt, Date.parse("2026-08-11T08:00:00.000Z"));
});

test("usage labels retain reported and partial provenance", () => {
  const summary = fleetUsageSummary({
    agentPubkey: CANDIDATE.pubkey,
    usage: {
      ...EMPTY_USAGE,
      totalTokens: { value: "1200", incomplete: true },
      estimatedCostUsd: { value: 0.0123, incomplete: true },
    },
    buckets: [],
    models: [
      {
        harness: "acp",
        model: "gpt-test",
        usage: EMPTY_USAGE,
        reportCount: 1,
        hasUnknownUsage: false,
      },
    ],
    reportCount: 1,
    hasUnknownUsage: true,
  });

  assert.equal(summary.tokenLabel, "Tokens: 1.2k reported (partial)");
  assert.match(
    summary.costLabel,
    /^Cost: ~\$0\.0123 reported estimate \(partial\)$/,
  );
  assert.equal(summary.modelLabel, "Model: gpt-test (reported)");
});

test("configured model remains explicit when no usage report names a model", () => {
  const summary = fleetUsageSummary(undefined, "gpt-configured");
  assert.equal(summary.modelLabel, "Model: gpt-configured (configured)");
  assert.equal(summary.tokenLabel, "Tokens unavailable");
  assert.equal(summary.costLabel, "Cost unavailable");
});

test("runtime attention reasons are actionable without leaking raw errors", () => {
  assert.equal(
    safeRuntimeAttentionReason(
      "Agent reported error (code -32000): Authentication required: secret=abc",
      -32000,
    ),
    "Authentication required",
  );
  assert.equal(
    safeRuntimeAttentionReason(
      "failed command contained API_KEY=secret",
      -32000,
    ),
    "Agent run failed",
  );
});

test("fleet filtering and activity sorting are deterministic", () => {
  const agents = [
    { ...CANDIDATE, name: "Zulu", status: "stopped", lastActivityAt: null },
    {
      ...CANDIDATE,
      name: "Alpha",
      status: "working",
      lastActivityAt: 20,
    },
    {
      ...CANDIDATE,
      name: "Bravo",
      status: "needs-attention",
      lastActivityAt: 10,
    },
  ].map((agent) => ({
    ...agent,
    currentAction: null,
    durationAnchorAt: null,
    usage: fleetUsageSummary(undefined),
  }));

  assert.deepEqual(
    filterAndSortFleetAgents(agents, "all", "activity").map(
      (agent) => agent.name,
    ),
    ["Alpha", "Bravo", "Zulu"],
  );
  assert.deepEqual(
    filterAndSortFleetAgents(agents, "stopped", "name").map(
      (agent) => agent.name,
    ),
    ["Zulu"],
  );
});

test("usage boundaries are local midnights rather than fixed-day arithmetic", () => {
  const boundaries = localMidnightBoundaries(
    2,
    new Date("2026-08-11T12:34:56"),
  );
  assert.equal(boundaries.length, 3);
  for (const boundary of boundaries) {
    const value = new Date(boundary * 1_000);
    assert.equal(value.getHours(), 0);
    assert.equal(value.getMinutes(), 0);
  }
  assert.equal(
    boundaries.at(-1),
    Math.floor(new Date("2026-08-12T00:00:00").getTime() / 1_000),
  );
  assert.equal(
    msUntilNextLocalMidnight(new Date("2026-08-11T23:59:59.500")),
    500,
  );
});

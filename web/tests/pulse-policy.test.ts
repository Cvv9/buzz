import assert from "node:assert/strict";
import test from "node:test";
import {
  groupAgentPulseEvents,
  projectPulseEvents,
  pulseReplyParent,
} from "../src/features/pulse/pulse-policy.ts";

const CHANNEL = "engineering";
const AGENT = "a".repeat(64);
const PERSON = "b".repeat(64);

function event(
  input: Partial<{
    id: string;
    pubkey: string;
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  }>,
) {
  return {
    id: input.id ?? "1".repeat(64),
    pubkey: input.pubkey ?? PERSON,
    kind: input.kind ?? 40002,
    content: input.content ?? "update",
    created_at: input.created_at ?? 1,
    tags: input.tags ?? [["h", CHANNEL]],
  };
}

test("Pulse projects only explicit readable h-scoped content and suppresses projects", () => {
  const projected = projectPulseEvents(
    [
      event({ id: "1".repeat(64), created_at: 5 }),
      event({ id: "2".repeat(64), kind: 30079, created_at: 6 }),
      event({ id: "3".repeat(64), tags: [] }),
      event({
        id: "4".repeat(64),
        tags: [
          ["h", CHANNEL],
          ["a", "30617:block:buzz"],
        ],
      }),
      event({ id: "5".repeat(64), kind: 45001, created_at: 7 }),
    ],
    [CHANNEL],
  );
  assert.deepEqual(
    projected.map((item) => item.id),
    ["5".repeat(64), "1".repeat(64)],
  );
});

test("Pulse uses lowest event id for equal-time ordering", () => {
  const projected = projectPulseEvents(
    [
      event({ id: "f".repeat(64), created_at: 5 }),
      event({ id: "0".repeat(64), created_at: 5 }),
    ],
    [CHANNEL],
  );
  assert.deepEqual(
    projected.map((item) => item.id),
    ["0".repeat(64), "f".repeat(64)],
  );
});

test("Pulse ports reply targeting and consecutive agent grouping", () => {
  const root = "c".repeat(64);
  const parent = "d".repeat(64);
  assert.equal(
    pulseReplyParent(
      event({
        tags: [
          ["h", CHANNEL],
          ["e", root, "", "root"],
          ["e", parent, "", "reply"],
        ],
      }),
    ),
    parent,
  );
  const groups = groupAgentPulseEvents(
    [
      event({ id: "1".repeat(64), pubkey: AGENT, created_at: 500 }),
      event({ id: "2".repeat(64), pubkey: AGENT, created_at: 250 }),
      event({ id: "3".repeat(64), pubkey: AGENT, created_at: -100 }),
    ],
    new Set([AGENT]),
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.events.length, 2);
});

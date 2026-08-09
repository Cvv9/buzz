import assert from "node:assert/strict";
import test from "node:test";
import {
  canJoinHuddle,
  foldHuddleLifecycle,
  isHuddleChannelId,
  newestHuddleGuideline,
  parseHuddleLifecycleEvent,
} from "../src/features/huddle/huddle-policy.ts";

const parent = "engineering";
const huddleId = "123e4567-e89b-42d3-a456-426614174000";
const creator = "a".repeat(64);
const participant = "b".repeat(64);

function event(
  kind: number,
  id: string,
  createdAt: number,
  tags: string[][],
  content = JSON.stringify({ ephemeral_channel_id: huddleId }),
  pubkey = creator,
) {
  return {
    id,
    kind,
    created_at: createdAt,
    tags,
    content,
    pubkey,
    sig: "0".repeat(128),
  };
}

test("huddle lifecycle folds only well-scoped signed event shapes", () => {
  const sessions = foldHuddleLifecycle(
    [
      event(48100, "start", 10, [["h", parent]]),
      event(48101, "join", 11, [
        ["h", parent],
        ["p", participant],
      ]),
      event(48102, "leave", 12, [
        ["h", parent],
        ["p", participant],
      ]),
      event(48103, "end", 13, [["h", parent]]),
      event(48101, "bad-channel", 14, [
        ["h", "other"],
        ["p", participant],
      ]),
      event(48101, "bad-member", 15, [
        ["h", parent],
        ["p", "not-a-pubkey"],
      ]),
    ],
    parent,
  );
  assert.deepEqual(sessions, [
    {
      ephemeralChannelId: huddleId,
      startedAt: 10,
      startedBy: creator,
      startedEventId: "start",
      endedAt: 13,
      participants: [],
    },
  ]);
  assert.equal(canJoinHuddle(sessions[0], 13_100), false);
});

test("canonical UUID validation rejects malformed hyphen placement", () => {
  assert.equal(isHuddleChannelId(huddleId), true);
  assert.equal(
    isHuddleChannelId("123e4567e-89b-42d3-a456-426614174000"),
    false,
  );
  const malformed = event(
    48100,
    "bad-uuid",
    10,
    [["h", parent]],
    JSON.stringify({
      ephemeral_channel_id: "123e4567e-89b-42d3-a456-426614174000",
    }),
  );
  assert.equal(parseHuddleLifecycleEvent(malformed, parent), null);
});

test("huddle parsers reject duplicate or conflicting scope and participant tags", () => {
  assert.equal(
    parseHuddleLifecycleEvent(
      event(48100, "duplicate-h", 10, [
        ["h", parent],
        ["h", "other"],
      ]),
      parent,
    ),
    null,
  );
  assert.equal(
    parseHuddleLifecycleEvent(
      event(48101, "duplicate-p", 10, [
        ["h", parent],
        ["p", participant],
        ["p", creator],
      ]),
      parent,
    ),
    null,
  );
  assert.equal(
    newestHuddleGuideline(
      [
        event(48106, "conflicting-guideline", 20, [
          ["h", huddleId],
          ["h", "123e4567-e89b-42d3-a456-426614174001"],
        ]),
      ],
      huddleId,
    ),
    null,
  );
});

test("equal timestamps retain NIP-01 lowest-id ordering", () => {
  const sessions = foldHuddleLifecycle(
    [
      event(48100, "start", 10, [["h", parent]]),
      event(48102, "b", 11, [
        ["h", parent],
        ["p", participant],
      ]),
      event(48101, "a", 11, [
        ["h", parent],
        ["p", participant],
      ]),
    ],
    parent,
  );
  assert.deepEqual(sessions[0]?.participants, [creator]);
});

test("guideline selection uses newest then lowest event id", () => {
  const newest = newestHuddleGuideline(
    [
      event(48106, "b", 20, [["h", huddleId]], "later lexical id"),
      event(48106, "a", 20, [["h", huddleId]], "earlier lexical id"),
      event(48106, "old", 19, [["h", huddleId]], "old"),
    ],
    huddleId,
  );
  assert.equal(newest?.content, "earlier lexical id");
});

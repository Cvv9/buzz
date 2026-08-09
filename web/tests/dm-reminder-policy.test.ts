import assert from "node:assert/strict";
import test from "node:test";
import { parseDmVisibilitySnapshot } from "../src/features/workspace/dm-visibility-policy.ts";
import {
  hasNavigableReminderTarget,
  normalizeReminderTarget,
  parseNotBefore,
  parseReminderContent,
} from "../src/features/reminders/reminder-policy.ts";

const viewer = "a".repeat(64);

function visibility(tags: string[][]) {
  return {
    id: "1".repeat(64),
    pubkey: "f".repeat(64),
    created_at: 10,
    kind: 30622,
    tags,
    content: "",
    sig: "0".repeat(128),
  };
}

test("uses only an exactly viewer-scoped DM visibility snapshot", () => {
  const hidden = parseDmVisibilitySnapshot(
    visibility([
      ["d", viewer],
      ["p", viewer],
      ["h", "123e4567-e89b-12d3-a456-426614174000"],
    ]),
    viewer,
  );
  assert.deepEqual(
    [...(hidden ?? [])],
    ["123e4567-e89b-12d3-a456-426614174000"],
  );
  assert.equal(
    parseDmVisibilitySnapshot(
      visibility([
        ["d", viewer],
        ["p", "b".repeat(64)],
      ]),
      viewer,
    ),
    null,
  );
  assert.equal(
    parseDmVisibilitySnapshot(
      visibility([
        ["d", viewer],
        ["d", viewer],
        ["p", viewer],
      ]),
      viewer,
    ),
    null,
  );
  assert.equal(
    parseDmVisibilitySnapshot(
      visibility([
        ["d", viewer],
        ["p", viewer],
        ["h", "123e4567e-89b-12d3-a456-426614174000"],
      ]),
      viewer,
    ),
    null,
  );
});

test("fails closed on malformed encrypted reminder plaintext and scheduling", () => {
  assert.equal(parseNotBefore("0"), 0);
  assert.equal(parseNotBefore("001"), undefined);
  assert.equal(parseNotBefore("-1"), undefined);
  assert.deepEqual(
    parseReminderContent(
      JSON.stringify({ status: "pending", note: "Call Sam" }),
    ),
    { status: "pending", note: "Call Sam", target: undefined },
  );
  assert.equal(
    parseReminderContent(JSON.stringify({ status: "pending" })),
    null,
  );
  assert.equal(parseReminderContent("not json"), null);
});

test("does not navigate arbitrary reminder targets", () => {
  assert.equal(
    hasNavigableReminderTarget({
      channelId: "123e4567-e89b-12d3-a456-426614174000",
      eventId: "c".repeat(64),
      authorPubkey: viewer,
      preview: "Private detail",
    }),
    true,
  );
  assert.equal(
    hasNavigableReminderTarget({
      channelId: "javascript:alert(1)",
      eventId: "c".repeat(64),
      authorPubkey: viewer,
      preview: "Private detail",
    }),
    false,
  );
  assert.equal(
    hasNavigableReminderTarget({
      channelId: "123e4567e-89b-12d3-a456-426614174000",
      eventId: "c".repeat(64),
      authorPubkey: viewer,
      preview: "Private detail",
    }),
    false,
  );
  assert.deepEqual(
    normalizeReminderTarget({
      channelId: "123E4567-E89B-12D3-A456-426614174000",
      eventId: "C".repeat(64),
      authorPubkey: "A".repeat(64),
      preview: "Private\u0000detail",
    }),
    {
      channelId: "123e4567-e89b-12d3-a456-426614174000",
      eventId: "c".repeat(64),
      authorPubkey: "a".repeat(64),
      preview: "Private detail",
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  lastReplyTimestamp,
  selectReplierPubkeys,
  type ThreadReplyLike,
} from "../src/features/workspace/thread-summary-policy.ts";

const reply = (pubkey: string, created_at: number): ThreadReplyLike => ({
  pubkey,
  created_at,
});

test("selectReplierPubkeys keeps distinct repliers in reply order", () => {
  assert.deepEqual(
    selectReplierPubkeys([
      reply("a", 1),
      reply("b", 2),
      reply("a", 3),
      reply("c", 4),
    ]),
    ["a", "b", "c"],
  );
});

test("selectReplierPubkeys caps the cluster at three by default", () => {
  assert.deepEqual(
    selectReplierPubkeys([
      reply("a", 1),
      reply("b", 2),
      reply("c", 3),
      reply("d", 4),
    ]),
    ["a", "b", "c"],
  );
});

test("selectReplierPubkeys honors a custom max", () => {
  assert.deepEqual(
    selectReplierPubkeys([reply("a", 1), reply("b", 2), reply("c", 3)], 2),
    ["a", "b"],
  );
});

test("selectReplierPubkeys includes the root author when they self-reply", () => {
  // Replies are the only source, so a root author appears iff they replied.
  assert.deepEqual(selectReplierPubkeys([reply("root", 1), reply("b", 2)]), [
    "root",
    "b",
  ]);
});

test("selectReplierPubkeys returns an empty list for no replies", () => {
  assert.deepEqual(selectReplierPubkeys([]), []);
});

test("lastReplyTimestamp returns the most recent reply time regardless of order", () => {
  assert.equal(
    lastReplyTimestamp([reply("a", 10), reply("b", 40), reply("c", 25)]),
    40,
  );
});

test("lastReplyTimestamp returns null when there are no replies", () => {
  assert.equal(lastReplyTimestamp([]), null);
});

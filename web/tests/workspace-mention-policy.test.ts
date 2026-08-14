import assert from "node:assert/strict";
import test from "node:test";
import {
  activeMentionQuery,
  applyMentionSelection,
  extractMentionPubkeys,
  filterMentionCandidates,
  type MentionCandidate,
} from "../src/features/workspace/workspace-mention-policy.ts";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const carol = "c".repeat(64);
const denver = "d".repeat(64);

test("activeMentionQuery finds a mention at the start of the text", () => {
  assert.deepEqual(activeMentionQuery("@al", 3), { start: 0, query: "al" });
});

test("activeMentionQuery finds a mention mid-text after whitespace", () => {
  const text = "hey @al how are you";
  assert.deepEqual(activeMentionQuery(text, 7), { start: 4, query: "al" });
});

test("activeMentionQuery finds a mention after a newline", () => {
  const text = "line one\n@al";
  assert.deepEqual(activeMentionQuery(text, text.length), {
    start: 9,
    query: "al",
  });
});

test("activeMentionQuery returns null when there is no @", () => {
  assert.equal(activeMentionQuery("hello there", 5), null);
});

test("activeMentionQuery returns null for email-like text", () => {
  assert.equal(activeMentionQuery("a@b", 3), null);
});

test("activeMentionQuery returns null after two consecutive spaces", () => {
  const text = "@al  ice";
  // caret placed right after the double space
  assert.equal(activeMentionQuery(text, 5), null);
});

test("activeMentionQuery rejects a query containing a second @, a newline, or a leading space", () => {
  assert.equal(activeMentionQuery("@a@b", 4), null);
  assert.equal(activeMentionQuery("@a\nb", 4), null);
  assert.equal(activeMentionQuery("@ al", 4), null);
});

test("activeMentionQuery rejects overly long queries", () => {
  const long = `@${"x".repeat(49)}`;
  assert.equal(activeMentionQuery(long, long.length), null);
});

const candidates: MentionCandidate[] = [
  { pubkey: alice, name: "Alice" },
  { pubkey: bob, name: "Bob", aliases: ["Bobby"] },
  { pubkey: carol, name: "Natalie" },
  { pubkey: denver, name: "Denver" },
];

test("filterMentionCandidates ranks prefix matches before substring matches", () => {
  const result = filterMentionCandidates(candidates, "al");
  assert.deepEqual(
    result.map((candidate) => candidate.pubkey),
    [alice, carol],
  );
});

test("filterMentionCandidates matches word-prefixes within a multi-word name", () => {
  const result = filterMentionCandidates(
    [{ pubkey: alice, name: "Alice Anderson" }],
    "and",
  );
  assert.deepEqual(
    result.map((candidate) => candidate.pubkey),
    [alice],
  );
});

test("filterMentionCandidates matches on aliases", () => {
  const result = filterMentionCandidates(candidates, "bobby");
  assert.deepEqual(
    result.map((candidate) => candidate.pubkey),
    [bob],
  );
});

test("filterMentionCandidates is case-insensitive", () => {
  const result = filterMentionCandidates(candidates, "ALICE");
  assert.deepEqual(
    result.map((candidate) => candidate.pubkey),
    [alice],
  );
});

test("filterMentionCandidates dedupes by lowercased pubkey, keeping the first occurrence", () => {
  const dupCandidates: MentionCandidate[] = [
    { pubkey: alice, name: "Alice" },
    { pubkey: alice.toUpperCase(), name: "Alice Duplicate" },
  ];
  const result = filterMentionCandidates(dupCandidates, "");
  assert.deepEqual(result, [{ pubkey: alice, name: "Alice" }]);
});

test("filterMentionCandidates returns everything for an empty query, capped at limit", () => {
  const result = filterMentionCandidates(candidates, "", 2);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((candidate) => candidate.pubkey),
    [alice, bob],
  );
});

test("filterMentionCandidates respects the limit across ranks", () => {
  const result = filterMentionCandidates(candidates, "a", 1);
  assert.equal(result.length, 1);
});

test("applyMentionSelection replaces the active query and advances the caret", () => {
  const text = "hey @al how are you";
  const mention = activeMentionQuery(text, 7);
  assert.ok(mention);
  const result = applyMentionSelection(text, mention, 7, "Alice");
  assert.equal(result.text, "hey @Alice  how are you");
  assert.equal(result.caret, "hey @Alice ".length);
});

test("applyMentionSelection works when the mention is at the start of the text", () => {
  const text = "@al";
  const mention = activeMentionQuery(text, 3);
  assert.ok(mention);
  const result = applyMentionSelection(text, mention, 3, "Alice");
  assert.equal(result.text, "@Alice ");
  assert.equal(result.caret, "@Alice ".length);
});

test("extractMentionPubkeys matches agents and members by name or alias", () => {
  const mentionCandidates: MentionCandidate[] = [
    { pubkey: alice, name: "Alice", isAgent: true },
    { pubkey: bob, name: "Bob", aliases: ["Bobby"] },
  ];
  const result = extractMentionPubkeys(
    "hey @alice and @bobby, take a look",
    mentionCandidates,
  );
  assert.deepEqual(result, [alice, bob]);
});

test("extractMentionPubkeys is case-insensitive", () => {
  const mentionCandidates: MentionCandidate[] = [
    { pubkey: alice, name: "Alice" },
  ];
  assert.deepEqual(extractMentionPubkeys("hey @ALICE", mentionCandidates), [
    alice,
  ]);
});

test("extractMentionPubkeys dedupes repeated mentions of the same candidate", () => {
  const mentionCandidates: MentionCandidate[] = [
    { pubkey: alice, name: "Alice" },
  ];
  assert.deepEqual(
    extractMentionPubkeys("@alice ping @alice again", mentionCandidates),
    [alice],
  );
});

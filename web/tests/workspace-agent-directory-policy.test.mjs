import assert from "node:assert/strict";
import test from "node:test";

import { hostedDirectoryEvents } from "../src/features/workspace/workspace-agent-directory-policy.ts";

test("hosted roster excludes managed projections that lack a kind:10100 directory entry", () => {
  const hosted = "a".repeat(64);
  const managedOnly = "b".repeat(64);
  const roster = hostedDirectoryEvents([
    { id: "1", kind: 10100, pubkey: hosted, created_at: 10 },
    { id: "2", kind: 30177, pubkey: managedOnly, created_at: 20 },
    { id: "3", kind: 30177, pubkey: hosted, created_at: 30 },
  ]);

  assert.deepEqual(
    roster.map((event) => event.pubkey),
    [hosted],
  );
});

test("hosted roster keeps only the latest directory head per agent", () => {
  const hosted = "a".repeat(64);
  const roster = hostedDirectoryEvents([
    { id: "a", kind: 10100, pubkey: hosted, created_at: 10 },
    { id: "b", kind: 10100, pubkey: hosted, created_at: 11 },
  ]);
  assert.equal(roster[0]?.id, "b");
});

test("hosted roster uses the canonical lowest-id same-second head", () => {
  const hosted = "a".repeat(64);
  const roster = hostedDirectoryEvents([
    { id: "f", kind: 10100, pubkey: hosted, created_at: 10 },
    { id: "0", kind: 10100, pubkey: hosted, created_at: 10 },
  ]);
  assert.equal(roster[0]?.id, "0");
});

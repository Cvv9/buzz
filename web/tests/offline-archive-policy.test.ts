import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveableChannelEvent,
  compareOfflineArchiveNewest,
  isBeforeOfflineCursor,
  offlineArchiveScope,
} from "../src/features/offline/offline-archive-policy.ts";

const ID = "a".repeat(64);
const PUBKEY = "b".repeat(64);
const SIG = "c".repeat(128);

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    pubkey: PUBKEY,
    sig: SIG,
    kind: 40002,
    content: "ordinary channel message",
    created_at: 10,
    tags: [["h", "engineering"]],
    ...overrides,
  };
}

test("offline archive admits only signed ordinary h-scoped channel events", () => {
  assert.equal(archiveableChannelEvent(event())?.id, ID);
  assert.equal(archiveableChannelEvent(event({ kind: 30174 })), null);
  assert.equal(archiveableChannelEvent(event({ tags: [["p", PUBKEY]] })), null);
  assert.equal(
    archiveableChannelEvent(
      event({
        tags: [
          ["h", "a"],
          ["h", "b"],
        ],
      }),
    ),
    null,
  );
  assert.equal(archiveableChannelEvent(event({ sig: "wrong" })), null);
});

test("offline archive partitions relay and identity and pages low-id same-second events", () => {
  assert.equal(
    offlineArchiveScope({ relayUrl: "wss://relay.example", pubkey: PUBKEY }),
    `v1:wss://relay.example/:${PUBKEY}`,
  );
  const newest = [
    { createdAt: 10, id: "f" },
    { createdAt: 10, id: "0" },
  ].sort(compareOfflineArchiveNewest);
  assert.deepEqual(
    newest.map((entry) => entry.id),
    ["0", "f"],
  );
  assert.equal(
    isBeforeOfflineCursor(
      { createdAt: 10, id: "f" },
      { createdAt: 10, id: "0" },
    ),
    true,
  );
});

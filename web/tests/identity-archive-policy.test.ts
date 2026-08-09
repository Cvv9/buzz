import assert from "node:assert/strict";
import test from "node:test";
import {
  KIND_IA_ARCHIVE_REQUEST,
  canManageIdentityArchive,
  identityArchiveTemplate,
  parseArchivedIdentitySnapshot,
  shouldFoldArchivedIdentity,
} from "../src/features/identity-archive/identity-archive-policy.ts";

const RELAY = "a".repeat(64);
const TARGET = "b".repeat(64);

test("identity archive request is protected and client validates the narrow browser path", () => {
  assert.deepEqual(
    identityArchiveTemplate({
      action: "archive",
      targetPubkey: TARGET,
      reason: "inactive",
    }),
    {
      kind: KIND_IA_ARCHIVE_REQUEST,
      content: "",
      tags: [["-"], ["p", TARGET], ["reason", "inactive"]],
    },
  );
  assert.throws(
    () =>
      identityArchiveTemplate({
        action: "archive",
        targetPubkey: TARGET,
        reason: "bad\nreason",
      }),
    /control/,
  );
  assert.equal(
    canManageIdentityArchive({ targetPubkey: TARGET, viewerPubkey: TARGET }),
    true,
  );
  assert.equal(
    canManageIdentityArchive({
      targetPubkey: TARGET,
      viewerPubkey: RELAY,
      communityRole: "member",
    }),
    false,
  );
});

test("only verified relay snapshot shape can archive presentation, and self is exempt from folding", () => {
  const snapshot = parseArchivedIdentitySnapshot(
    {
      id: "1".repeat(64),
      pubkey: RELAY,
      kind: 13535,
      created_at: 1,
      content: "",
      tags: [["-"], ["p", TARGET]],
    },
    RELAY,
  );
  assert.deepEqual([...(snapshot?.archived ?? [])], [TARGET]);
  assert.equal(
    parseArchivedIdentitySnapshot(
      {
        id: "1".repeat(64),
        pubkey: RELAY,
        kind: 13535,
        created_at: 1,
        content: "",
        tags: [["-"], ["-"], ["p", TARGET]],
      },
      RELAY,
    ),
    null,
  );
  assert.equal(
    shouldFoldArchivedIdentity(TARGET, TARGET, snapshot?.archived ?? new Set()),
    false,
  );
  assert.equal(
    shouldFoldArchivedIdentity(TARGET, RELAY, snapshot?.archived ?? new Set()),
    true,
  );
});

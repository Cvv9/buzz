import assert from "node:assert/strict";
import test from "node:test";
import {
  availableWorkspaceInvitees,
  canRemoveWorkspaceChannelMember,
} from "../src/features/workspace/workspace-channel-members-policy.ts";

const first = "a".repeat(64);
const second = "b".repeat(64);

test("invite candidates are deduplicated and exclude existing members", () => {
  assert.deepEqual(
    availableWorkspaceInvitees(
      [
        { pubkey: first.toUpperCase(), role: "member" },
        { pubkey: second, role: "admin" },
        { pubkey: second, role: "admin" },
      ],
      [{ pubkey: first, role: "member" }],
    ),
    [{ pubkey: second, role: "admin" }],
  );
});

test("channel owners never receive an ordinary remove action", () => {
  assert.equal(
    canRemoveWorkspaceChannelMember({
      member: { pubkey: first, role: "owner" },
      canManage: true,
      viewerPubkey: first,
    }),
    false,
  );
  assert.equal(
    canRemoveWorkspaceChannelMember({
      member: { pubkey: second, role: "member" },
      canManage: false,
      viewerPubkey: second,
    }),
    true,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultInviteRoleForCandidate,
  partitionWorkspaceInviteCandidates,
} from "../src/features/workspace/workspace-invite-candidates-policy.ts";

const human = "a".repeat(64);
const agent = "b".repeat(64);
const otherHuman = "c".repeat(64);

test("splits candidates into humans and agents, preserving order", () => {
  const { members, agents } = partitionWorkspaceInviteCandidates(
    [
      { pubkey: human, role: "member" },
      { pubkey: agent, role: "member" },
      { pubkey: otherHuman, role: "admin" },
    ],
    [{ pubkey: agent.toUpperCase(), name: "Helper" }],
  );
  assert.deepEqual(members, [
    { pubkey: human, role: "member" },
    { pubkey: otherHuman, role: "admin" },
  ]);
  assert.deepEqual(agents, [{ pubkey: agent, role: "member" }]);
});

test("returns empty groups when there are no candidates", () => {
  assert.deepEqual(partitionWorkspaceInviteCandidates([], []), {
    members: [],
    agents: [],
  });
});

test("agents default to the bot role", () => {
  assert.equal(
    defaultInviteRoleForCandidate(agent, [
      { pubkey: agent.toUpperCase(), name: "Helper" },
    ]),
    "bot",
  );
});

test("humans default to the member role", () => {
  assert.equal(
    defaultInviteRoleForCandidate(human, [{ pubkey: agent, name: "Helper" }]),
    "member",
  );
});

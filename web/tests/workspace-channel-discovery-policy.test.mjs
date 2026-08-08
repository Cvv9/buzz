import assert from "node:assert/strict";
import test from "node:test";
import { canDiscoverPrivateWorkspaceChannels } from "../src/features/workspace/workspace-channel-discovery-policy.ts";

test("only community owners and admins can reach private channel discovery", () => {
  const members = [
    { pubkey: "owner", role: "owner" },
    { pubkey: "admin", role: "admin" },
    { pubkey: "member", role: "member" },
  ];
  assert.equal(canDiscoverPrivateWorkspaceChannels("OWNER", members), true);
  assert.equal(canDiscoverPrivateWorkspaceChannels("admin", members), true);
  assert.equal(canDiscoverPrivateWorkspaceChannels("member", members), false);
});

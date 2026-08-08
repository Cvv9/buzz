import assert from "node:assert/strict";
import test from "node:test";
import {
  changedWorkspaceChannelUpdate,
  workspaceChannelDraft,
} from "../src/features/workspace/workspace-channel-update-policy.ts";

const channel = {
  id: "channel-1",
  name: "General",
  about: "Team updates",
  topic: "",
  type: "stream",
  visibility: "public",
  role: "owner",
  memberPubkeys: [],
  catalogSection: "General",
};

test("channel metadata edits only publish dirty fields", () => {
  assert.deepEqual(
    changedWorkspaceChannelUpdate(channel, {
      ...workspaceChannelDraft(channel),
      catalogSection: "Command Center",
    }),
    { catalogSection: "Command Center" },
  );
});

test("channel metadata draft is reset from the refreshed relay projection", () => {
  const refreshed = {
    ...channel,
    name: "Announcements",
    visibility: "private",
  };
  assert.deepEqual(workspaceChannelDraft(refreshed), {
    name: "Announcements",
    about: "Team updates",
    catalogSection: "General",
    visibility: "private",
  });
});

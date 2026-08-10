import assert from "node:assert/strict";
import test from "node:test";
import { groupWorkspaceAgentChannels } from "../src/features/workspace/workspace-agent-access-policy.ts";

const channel = (overrides: Record<string, unknown> = {}) => ({
  id: "channel-1",
  name: "general",
  about: "Team updates",
  topic: "",
  type: "stream" as const,
  visibility: "public" as const,
  role: "owner",
  memberPubkeys: [],
  catalogSection: "General",
  ...overrides,
});

test("agent channel access groups by the shared catalog section", () => {
  const groups = groupWorkspaceAgentChannels(
    [
      channel({ id: "2", name: "zebra", catalogSection: "Operations" }),
      channel({ id: "1", name: "alpha", catalogSection: "Operations" }),
      channel({ id: "3", name: "loose", catalogSection: "" }),
    ],
    "",
  );

  assert.deepEqual(
    groups.map((group) => [
      group.label,
      group.channels.map((item) => item.name),
    ]),
    [
      ["Operations", ["alpha", "zebra"]],
      ["Other channels", ["loose"]],
    ],
  );
});

test("agent channel access search matches descriptions and catalog sections", () => {
  const channels = [
    channel({ name: "brief-varun", about: "Private chief-of-staff brief" }),
    channel({ name: "ops-desk", catalogSection: "Command Center" }),
  ];

  assert.deepEqual(
    groupWorkspaceAgentChannels(channels, "chief")[0]?.channels.map(
      (item) => item.name,
    ),
    ["brief-varun"],
  );
  assert.deepEqual(
    groupWorkspaceAgentChannels(channels, "command")[0]?.channels.map(
      (item) => item.name,
    ),
    ["ops-desk"],
  );
});

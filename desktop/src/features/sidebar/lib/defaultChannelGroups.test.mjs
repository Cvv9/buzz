import assert from "node:assert/strict";
import test from "node:test";

import {
  isProjectChannel,
  partitionDefaultChannelGroups,
} from "./defaultChannelGroups.ts";

function channel(name) {
  return { id: name, name };
}

test("uses the same named project channels as the web workspace", () => {
  for (const name of [
    "aaral-pms",
    "sylars-control",
    "varvik-suite",
    "zup-coffee",
  ]) {
    assert.equal(isProjectChannel(channel(name)), true, name);
  }
});

test("recognizes future project-prefixed channels", () => {
  assert.equal(isProjectChannel(channel("project-atlas")), true);
  assert.equal(isProjectChannel(channel("PROJECT-ATLAS")), true);
});

test("keeps operational channels in Workspace", () => {
  const result = partitionDefaultChannelGroups([
    channel("general"),
    channel("watchdog-alerts"),
    channel("varvik-suite"),
    channel("project-atlas"),
  ]);

  assert.deepEqual(
    result.workspace.map((item) => item.name),
    ["general", "watchdog-alerts"],
  );
  assert.deepEqual(
    result.projects.map((item) => item.name),
    ["varvik-suite", "project-atlas"],
  );
});

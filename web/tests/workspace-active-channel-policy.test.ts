import assert from "node:assert/strict";
import test from "node:test";
import { resolveActiveChannelId } from "../src/features/workspace/workspace-active-channel-policy.ts";

test("keeps the stored selection when it is among the loaded channels", () => {
  assert.equal(
    resolveActiveChannelId({
      activeChannelId: "welcome",
      visibleChannelIds: ["factoryos", "welcome", "random"],
    }),
    "welcome",
  );
});

test("falls back to the first visible channel when the selection is absent", () => {
  assert.equal(
    resolveActiveChannelId({
      activeChannelId: "welcome",
      visibleChannelIds: ["factoryos", "random"],
    }),
    "factoryos",
  );
});

test("selects the first channel when nothing is active yet", () => {
  assert.equal(
    resolveActiveChannelId({
      activeChannelId: null,
      visibleChannelIds: ["factoryos"],
    }),
    "factoryos",
  );
});

test("resolves to null when there are no visible channels", () => {
  assert.equal(
    resolveActiveChannelId({
      activeChannelId: "welcome",
      visibleChannelIds: [],
    }),
    null,
  );
});

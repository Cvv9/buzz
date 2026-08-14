import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSeedHorizon,
  seedMarkerForAbsentChannel,
} from "../src/features/workspace/workspace-read-state-seed-policy.mjs";

const viewer = "a".repeat(64);
const other = "b".repeat(64);

const external = (created_at) => ({ created_at, pubkey: other });
const own = (created_at) => ({ created_at, pubkey: viewer });

test("first visit seeds an absent channel to its newest external message", () => {
  const seed = seedMarkerForAbsentChannel({
    channelEvents: [external(100), external(102), external(101)],
    pubkey: viewer,
    seededAt: 1_000,
    storeExisted: false,
  });
  assert.equal(seed, 102);
});

test("first visit ignores the viewer's own messages when choosing the seed", () => {
  const seed = seedMarkerForAbsentChannel({
    channelEvents: [external(100), own(500)],
    pubkey: viewer.toUpperCase(),
    seededAt: 1_000,
    storeExisted: false,
  });
  assert.equal(seed, 100);
});

test("subsequent mounts never seed, so post-store messages stay unread", () => {
  const seed = seedMarkerForAbsentChannel({
    channelEvents: [external(20), external(21)],
    pubkey: viewer,
    seededAt: 1_000,
    storeExisted: true,
  });
  assert.equal(seed, null);
});

test("messages after the seed horizon are never seeded on a first visit", () => {
  const seed = seedMarkerForAbsentChannel({
    channelEvents: [external(1_500), external(1_600)],
    pubkey: viewer,
    seededAt: 1_000,
    storeExisted: false,
  });
  assert.equal(seed, null);
});

test("mixed history seeds to the newest message at or before the horizon", () => {
  const seed = seedMarkerForAbsentChannel({
    channelEvents: [external(900), external(1_000), external(1_100)],
    pubkey: viewer,
    seededAt: 1_000,
    storeExisted: false,
  });
  assert.equal(seed, 1_000);
});

test("a channel with no external history yields no seed", () => {
  const seed = seedMarkerForAbsentChannel({
    channelEvents: [own(10), own(11)],
    pubkey: viewer,
    seededAt: 1_000,
    storeExisted: false,
  });
  assert.equal(seed, null);
});

test("resolveSeedHorizon keeps a valid stored horizon", () => {
  assert.deepEqual(resolveSeedHorizon(1_234, 9_999), {
    seededAt: 1_234,
    needsStamp: false,
  });
});

test("resolveSeedHorizon stamps legacy or invalid horizons with now", () => {
  for (const legacy of [undefined, null, -1, 1.5, "5", Number.NaN]) {
    assert.deepEqual(resolveSeedHorizon(legacy, 9_999), {
      seededAt: 9_999,
      needsStamp: true,
    });
  }
});

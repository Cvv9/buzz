import assert from "node:assert/strict";
import test from "node:test";
import { encodedHuddleFrameMetadata } from "../src/features/huddle/huddle-audio-policy.ts";

test("delayed WebCodecs output keeps each capture frame timestamp and level", () => {
  const captureLevels = new Map([
    [0, -42],
    [20_000, -18],
    [40_000, -7],
  ]);

  // A codec may emit the third frame before an earlier queued frame. Header
  // metadata must use the output chunk's original timestamp, not mutable state.
  assert.deepEqual(encodedHuddleFrameMetadata(40_000, captureLevels), {
    timestamp48k: 1_920,
    levelDbov: -7,
  });
  assert.deepEqual(encodedHuddleFrameMetadata(0, captureLevels), {
    timestamp48k: 0,
    levelDbov: -42,
  });
  assert.deepEqual(encodedHuddleFrameMetadata(80_000, captureLevels), {
    timestamp48k: 3_840,
    levelDbov: -127,
  });
});

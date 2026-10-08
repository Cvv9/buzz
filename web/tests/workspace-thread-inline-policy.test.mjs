import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INLINE_THREAD_REPLY_LIMIT,
  shouldShowThreadInline,
} from "../src/features/workspace/workspace-thread-inline-policy.mjs";

test("short threads render under the message; long ones open the panel", () => {
  assert.equal(INLINE_THREAD_REPLY_LIMIT, 6);
  assert.equal(shouldShowThreadInline(0), false);
  for (let count = 1; count <= 6; count += 1)
    assert.equal(shouldShowThreadInline(count), true);
  assert.equal(shouldShowThreadInline(7), false);
  assert.equal(shouldShowThreadInline(Number.NaN), false);
});

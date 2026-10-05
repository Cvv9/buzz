import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampSidebarWidth,
  sidebarWidthLimit,
  readSidebarWidth,
} from "../src/features/workspace/workspace-sidebar-width-policy.mjs";

test("sidebar resizing keeps a readable conversation and stays within limits", () => {
  assert.equal(clampSidebarWidth(100, 1440), 224);
  assert.equal(clampSidebarWidth(900, 1440), 480);
  assert.equal(clampSidebarWidth(480, 768), 408);
  assert.equal(sidebarWidthLimit(320), 224);
});
test("invalid stored widths recover to the default", () => {
  for (const value of [null, "", "broken", "NaN", "Infinity"])
    assert.equal(readSidebarWidth(value, 1440), 272);
  assert.equal(readSidebarWidth("380", 1440), 380);
  assert.equal(readSidebarWidth("480", 768), 408);
});

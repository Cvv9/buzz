import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampThreadPanelWidth,
  readThreadPanelWidth,
  threadPanelWidthLimit,
} from "../src/features/workspace/workspace-thread-panel-width-policy.mjs";

test("thread panel resizing keeps the conversation readable and stays within limits", () => {
  assert.equal(clampThreadPanelWidth(100, 1440), 320);
  assert.equal(clampThreadPanelWidth(900, 1440), 720);
  assert.equal(clampThreadPanelWidth(700, 1024), 464);
  assert.equal(threadPanelWidthLimit(640), 320);
});

test("invalid stored thread panel widths recover to the default", () => {
  for (const value of [null, "", "broken", "NaN", "Infinity"])
    assert.equal(readThreadPanelWidth(value, 1440), 384);
  assert.equal(readThreadPanelWidth("500", 1440), 500);
  assert.equal(readThreadPanelWidth("720", 1024), 464);
});

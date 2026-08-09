import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_MUTES_D_TAG,
  channelStateStorageKey,
  compareNewestReplaceableHead,
  draftContextId,
  mergeChannelMuteStores,
  nextChannelStateCreatedAt,
  parseChannelDraftStore,
  parseChannelMuteStore,
  userEventListTemplate,
} from "../src/features/channel-state/channel-state-policy.ts";

test("channel mute payload is strict and merges newest channel entries", () => {
  assert.deepEqual(
    parseChannelMuteStore({
      version: 1,
      channels: { a: { muted: true, updatedAt: 1 } },
    }),
    {
      version: 1,
      channels: { a: { muted: true, updatedAt: 1 } },
    },
  );
  assert.equal(parseChannelMuteStore({ version: 1, channels: [] }), null);
  assert.deepEqual(
    mergeChannelMuteStores(
      { version: 1, channels: { a: { muted: false, updatedAt: 2 } } },
      {
        version: 1,
        channels: {
          a: { muted: true, updatedAt: 1 },
          b: { muted: true, updatedAt: 3 },
        },
      },
    ),
    {
      version: 1,
      channels: {
        a: { muted: false, updatedAt: 2 },
        b: { muted: true, updatedAt: 3 },
      },
    },
  );
  assert.equal(CHANNEL_MUTES_D_TAG, "channel-mutes");
  assert.equal(
    nextChannelStateCreatedAt(100, 100),
    101,
    "same-second remote head cannot win NIP-33 replacement",
  );
  assert.equal(
    nextChannelStateCreatedAt(100, 101),
    102,
    "newer remote head advances browser publication",
  );
});

test("replaceable same-second heads choose the lowest event id", () => {
  const heads = [
    { created_at: 100, id: "f".repeat(64) },
    { created_at: 100, id: "0".repeat(64) },
    { created_at: 99, id: "a".repeat(64) },
  ];
  assert.equal(
    [...heads].sort(compareNewestReplaceableHead)[0]?.id,
    "0".repeat(64),
  );
});

test("drafts are relay and identity scoped with validated thread contexts", () => {
  assert.equal(draftContextId("general", "root"), "general:thread:root");
  assert.equal(draftContextId("general"), "general:channel");
  assert.throws(() => draftContextId(""), /channel/);
  assert.equal(
    parseChannelDraftStore({
      version: 1,
      drafts: { a: { content: "x", updatedAt: 1 } },
    })?.drafts.a?.content,
    "x",
  );
  assert.match(
    channelStateStorageKey("drafts", "wss://relay.one", "A".repeat(64)),
    /wss:\/\/relay.one:a+/,
  );
});

test("pin and bookmark lists preserve profile-level references without h tags", () => {
  const event = "e".repeat(64);
  assert.deepEqual(
    userEventListTemplate(
      10003,
      [
        ["e", "a".repeat(64)],
        ["e", "not-an-event-id"],
        ["h", "must-not-leak"],
      ],
      event,
      true,
    ),
    {
      kind: 10003,
      content: "",
      tags: [
        ["e", "a".repeat(64)],
        ["e", event],
      ],
    },
  );
});

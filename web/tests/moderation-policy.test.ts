import assert from "node:assert/strict";
import test from "node:test";
import {
  KIND_MODERATION_BAN,
  KIND_MODERATION_RESOLVE_REPORT,
  KIND_REPORT,
  moderationTemplate,
  reportTemplate,
} from "../src/features/moderation/moderation-policy.ts";

const PUBKEY = "a".repeat(64);
const EVENT = "b".repeat(64);

test("report is exact NIP-56 event target with no accidental h scoping", () => {
  const template = reportTemplate({
    authorPubkey: PUBKEY.toUpperCase(),
    eventId: EVENT,
    reportType: "spam",
    note: "noise",
  });
  assert.equal(template.kind, KIND_REPORT);
  assert.deepEqual(template.tags, [
    ["p", PUBKEY],
    ["e", EVENT, "spam"],
  ]);
  assert.equal(
    template.tags.some((tag) => tag[0] === "h"),
    false,
  );
});

test("moderation commands use the canonical global tag forms", () => {
  assert.deepEqual(
    moderationTemplate({
      action: "ban",
      pubkey: PUBKEY,
      expiresAt: 9,
      reason: "repeat",
    }),
    {
      kind: KIND_MODERATION_BAN,
      content: "",
      tags: [
        ["p", PUBKEY],
        ["expiration", "9"],
        ["reason", "repeat"],
      ],
    },
  );
  assert.deepEqual(
    moderationTemplate({
      action: "resolve",
      reportEventId: EVENT,
      status: "dismissed",
      resolution: "dismiss",
    }),
    {
      kind: KIND_MODERATION_RESOLVE_REPORT,
      content: "",
      tags: [
        ["report", EVENT],
        ["status", "dismissed"],
        ["action", "dismiss"],
      ],
    },
  );
  assert.throws(
    () =>
      moderationTemplate({
        action: "resolve",
        reportEventId: EVENT,
        status: "dismissed",
        resolution: "ban",
      }),
    /Dismissed/,
  );
  assert.throws(
    () =>
      moderationTemplate({ action: "timeout", pubkey: PUBKEY, expiresAt: 0 }),
    /Expiration/,
  );
});

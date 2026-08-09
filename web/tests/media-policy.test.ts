import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOutgoingMediaMessage,
  isSafeRelayMediaUrl,
  MAX_RENDERED_MEDIA_ATTACHMENTS,
  parseImetaTags,
  stripAttachmentMarkdown,
  validateMediaFile,
} from "../src/features/media/media-policy.ts";

const hash = "a".repeat(64);
const attachment = {
  url: `https://relay.example/media/${hash}.png`,
  sha256: hash,
  size: 123,
  type: "image/png",
  uploaded: 1,
  filename: "plan.png",
};

test("rejects active files and relay-limit overages before upload", () => {
  assert.match(
    validateMediaFile({
      name: "unsafe.svg",
      size: 12,
      type: "image/svg+xml",
    }) ?? "",
    /cannot be attached/,
  );
  assert.match(
    validateMediaFile({
      name: "large.png",
      size: 51 * 1024 * 1024,
      type: "image/png",
    }) ?? "",
    /50 MB/,
  );
  assert.match(
    validateMediaFile({
      name: "clip.mov",
      size: 1024,
      type: "video/quicktime",
    }) ?? "",
    /Only MP4/,
  );
  assert.equal(
    validateMediaFile({
      name: "report.pdf",
      size: 1024,
      type: "application/pdf",
    }),
    null,
  );
});

test("builds complete imeta metadata and durable attachment markdown", () => {
  const outgoing = buildOutgoingMediaMessage("Ship it", [attachment]);
  assert.equal(
    outgoing.content,
    `Ship it\n![image](https://relay.example/media/${hash}.png)`,
  );
  assert.deepEqual(outgoing.mediaTags, [
    [
      "imeta",
      `url https://relay.example/media/${hash}.png`,
      "m image/png",
      `x ${hash}`,
      "size 123",
      "filename plan.png",
    ],
  ]);
  assert.deepEqual(parseImetaTags(outgoing.mediaTags ?? []), [
    {
      url: `https://relay.example/media/${hash}.png`,
      type: "image/png",
      sha256: hash,
      size: 123,
      filename: "plan.png",
    },
  ]);
});

test("only authenticated current-relay media is eligible for inline display", () => {
  assert.equal(
    isSafeRelayMediaUrl(
      `https://relay.example/media/${hash}.png`,
      "https://relay.example",
    ),
    true,
  );
  assert.equal(
    isSafeRelayMediaUrl(
      `https://evil.example/media/${hash}.png`,
      "https://relay.example",
    ),
    false,
  );
  assert.equal(
    isSafeRelayMediaUrl(
      "https://relay.example/media/not-a-hash.png",
      "https://relay.example",
    ),
    false,
  );
});

test("suppresses only imeta-owned standalone markdown before safe rendering", () => {
  const content = `One line\n![image](https://relay.example/media/${hash}.png)\nLast line`;
  assert.equal(
    stripAttachmentMarkdown(content, [attachment]),
    "One line\nLast line",
  );
  assert.equal(
    stripAttachmentMarkdown("Look at https://relay.example/media/a.png", [
      attachment,
    ]),
    "Look at https://relay.example/media/a.png",
  );
});

test("caps untrusted imeta lists before gallery rendering", () => {
  const tags = Array.from(
    { length: MAX_RENDERED_MEDIA_ATTACHMENTS + 4 },
    (_, index) => [
      "imeta",
      `url https://relay.example/media/${index.toString(16).padStart(64, "0")}.png`,
      "m image/png",
      `x ${index.toString(16).padStart(64, "0")}`,
      "size 1",
    ],
  );
  assert.equal(parseImetaTags(tags).length, MAX_RENDERED_MEDIA_ATTACHMENTS);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomEmojiTags,
  buildCustomEmojiSet,
  customEmojiFromReaction,
  isSafeEmojiImageUrl,
  unionCustomEmoji,
} from "../src/features/custom-emoji/custom-emoji-policy.ts";

const AUTHOR = "a".repeat(64);

function event(
  input: Partial<{
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
  }>,
) {
  return {
    id: input.id ?? "b".repeat(64),
    pubkey: input.pubkey ?? AUTHOR,
    kind: input.kind ?? 30030,
    created_at: input.created_at ?? 1,
    tags: input.tags ?? [
      ["d", "buzz:custom-emoji"],
      ["emoji", "party", "https://example.test/party.png"],
    ],
  };
}

test("emoji palette selects latest heads with lowest-id tie break and rejects unsafe media", () => {
  const palette = unionCustomEmoji([
    event({
      id: "z",
      created_at: 10,
      tags: [
        ["d", "buzz:custom-emoji"],
        ["emoji", "party", "https://example.test/old.png"],
      ],
    }),
    event({
      id: "a",
      created_at: 10,
      tags: [
        ["d", "buzz:custom-emoji"],
        ["emoji", "party", "https://example.test/new.png"],
      ],
    }),
    event({
      id: "c",
      pubkey: "c".repeat(64),
      kind: 10030,
      tags: [
        ["emoji", "unsafe", "javascript:alert(1)"],
        ["emoji", "vector", "https://example.test/icon.svg"],
      ],
    }),
  ]);
  assert.deepEqual(palette, [
    { shortcode: "party", url: "https://example.test/new.png" },
  ]);
  assert.equal(isSafeEmojiImageUrl("data:image/png;base64,AAA"), false);
  assert.equal(isSafeEmojiImageUrl("https://example.test/icon.svg"), false);
});

test("custom emoji set writer emits canonical NIP-30 tags", () => {
  assert.deepEqual(
    buildCustomEmojiSet([
      { shortcode: ":Party_Parrot:", url: "https://example.test/parrot.png" },
    ]),
    {
      kind: 30030,
      content: "",
      tags: [
        ["d", "buzz:custom-emoji"],
        ["emoji", "party_parrot", "https://example.test/parrot.png"],
      ],
    },
  );
});

test("outgoing custom emoji is self-contained and reaction tags fail closed", () => {
  const party = { shortcode: "party", url: "https://example.test/party.png" };
  assert.deepEqual(buildCustomEmojiTags("One :party: then :PARTY:", [party]), [
    ["emoji", "party", "https://example.test/party.png"],
  ]);
  assert.deepEqual(
    customEmojiFromReaction(":PARTY:", [
      ["e", "c".repeat(64)],
      ["emoji", "party", "https://example.test/party.png"],
    ]),
    party,
  );
  assert.equal(
    customEmojiFromReaction(":party:", [
      ["emoji", "party", "https://example.test/party.png"],
      ["emoji", "party", "https://example.test/other.png"],
    ]),
    null,
  );
});

test("rejects conflicting parameterized emoji-set coordinates", () => {
  assert.deepEqual(
    unionCustomEmoji([
      event({
        tags: [
          ["d", "buzz:custom-emoji"],
          ["d", "another-set"],
          ["emoji", "party", "https://example.test/party.png"],
        ],
      }),
    ]),
    [],
  );
});

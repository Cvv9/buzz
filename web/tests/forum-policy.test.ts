import assert from "node:assert/strict";
import test from "node:test";
import {
  assertForumTarget,
  forumCommentReferences,
  projectForumPosts,
  projectForumThread,
} from "../src/features/forum/forum-policy.ts";

const CHANNEL = "forum-channel";
const POST = "a".repeat(64);
const COMMENT = "b".repeat(64);

function event(
  input: Partial<{
    id: string;
    pubkey: string;
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  }>,
) {
  return {
    id: input.id ?? "f".repeat(64),
    pubkey: input.pubkey ?? "c".repeat(64),
    kind: input.kind ?? 45001,
    content: input.content ?? "post",
    created_at: input.created_at ?? 1,
    tags: input.tags ?? [["h", CHANNEL]],
  };
}

test("forum projection requires h, resolves replies, deletions, and latest votes", () => {
  const posts = projectForumPosts(CHANNEL, [
    event({ id: POST, created_at: 10 }),
    event({
      id: COMMENT,
      kind: 45003,
      created_at: 11,
      tags: [
        ["h", CHANNEL],
        ["e", POST, "", "reply"],
      ],
    }),
    event({
      id: "d".repeat(64),
      kind: 45002,
      content: "+",
      created_at: 12,
      tags: [
        ["h", CHANNEL],
        ["e", POST],
      ],
    }),
    event({
      id: "e".repeat(64),
      kind: 45002,
      content: "-",
      created_at: 13,
      tags: [
        ["h", CHANNEL],
        ["e", POST],
      ],
    }),
    event({
      id: "0".repeat(64),
      pubkey: "c".repeat(64),
      kind: 45002,
      content: "+",
      created_at: 13,
      tags: [
        ["h", CHANNEL],
        ["e", POST],
      ],
    }),
    event({
      id: "9".repeat(64),
      kind: 45001,
      created_at: 99,
      tags: [],
    }),
  ]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.commentCount, 1);
  assert.equal(
    posts[0]?.score,
    1,
    "same-author newer vote supersedes prior vote",
  );
  assert.equal(posts[0]?.voterCount, 1);
  assert.equal(
    posts[0]?.score,
    1,
    "same-second selection is deterministic and uses the lowest event id",
  );

  const thread = projectForumThread(CHANNEL, POST, [
    event({ id: POST, created_at: 10 }),
    event({
      id: COMMENT,
      kind: 45003,
      created_at: 11,
      tags: [
        ["h", CHANNEL],
        ["e", POST, "", "reply"],
      ],
    }),
    event({
      id: "f".repeat(64),
      kind: 9005,
      created_at: 12,
      tags: [
        ["h", CHANNEL],
        ["e", COMMENT],
      ],
    }),
  ]);
  assert.equal(thread.comments.length, 0, "NIP-29 deletes remove comments");
});

test("forum comments preserve NIP-10 direct and nested reply references", () => {
  assert.deepEqual(
    forumCommentReferences(
      event({
        tags: [
          ["h", CHANNEL],
          ["e", POST, "", "reply"],
        ],
      }),
    ),
    { rootEventId: POST, parentEventId: POST },
  );
  assert.deepEqual(
    forumCommentReferences(
      event({
        tags: [
          ["h", CHANNEL],
          ["e", POST, "", "root"],
          ["e", COMMENT, "", "reply"],
        ],
      }),
    ),
    { rootEventId: POST, parentEventId: COMMENT },
  );
  assert.equal(assertForumTarget(POST.toUpperCase()), POST);
  assert.throws(() => assertForumTarget("not-an-event"), /valid event id/);
});

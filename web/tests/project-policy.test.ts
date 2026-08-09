import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectCollection,
  buildRepositoryWorkItems,
  parseProjectEvent,
} from "../src/features/projects/project-policy.ts";

const OWNER = "a".repeat(64);
const MAINTAINER = "b".repeat(64);
const ATTACKER = "c".repeat(64);
const REPOSITORY_D = "buzz";
const REPOSITORY = `30617:${OWNER}:${REPOSITORY_D}`;
const PROJECT = `30621:${OWNER}:delivery`;
const ISSUE_ID = "1".repeat(64);

function event(input: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d".repeat(64),
    pubkey: OWNER,
    kind: 30617,
    created_at: 100,
    content: "",
    tags: [["d", REPOSITORY_D]],
    ...input,
  };
}

test("NIP-MP projects require a single valid d tag and bounded canonical repository members", () => {
  assert.equal(
    parseProjectEvent(
      event({
        kind: 30621,
        tags: [
          ["d", "delivery"],
          ["a", REPOSITORY],
          ["name", "Delivery"],
        ],
      }),
    )?.address,
    PROJECT,
  );
  assert.equal(
    parseProjectEvent(
      event({
        kind: 30621,
        tags: [
          ["d", "delivery"],
          ["d", "other"],
          ["a", REPOSITORY],
        ],
      }),
    ),
    null,
    "duplicate d tags never choose an arbitrary replaceable coordinate",
  );
  assert.equal(
    parseProjectEvent(
      event({
        kind: 30621,
        tags: [
          ["d", "delivery"],
          ["a", `30617:${OWNER.toUpperCase()}:buzz`],
        ],
      }),
    ),
    null,
    "mixed-case owners are not canonical NIP-01 coordinates",
  );
});

test("authorized claims suppress standalone repositories; foreign claims stay visible but do not hide them", () => {
  const repository = event({
    tags: [
      ["d", REPOSITORY_D],
      ["maintainers", MAINTAINER],
    ],
  });
  const foreignProject = event({
    id: "e".repeat(64),
    pubkey: ATTACKER,
    kind: 30621,
    tags: [
      ["d", "foreign"],
      ["a", REPOSITORY],
    ],
  });
  const ownerProject = event({
    id: "f".repeat(64),
    kind: 30621,
    tags: [
      ["d", "owner"],
      ["a", REPOSITORY],
    ],
  });
  const collection = buildProjectCollection({
    projectEvents: [foreignProject, ownerProject],
    repositoryEvents: [repository],
  });
  assert.equal(collection.containers.length, 2);
  assert.equal(
    collection.containers.find((project) => project.owner === ATTACKER)
      ?.members[0]?.claimed,
    false,
  );
  assert.equal(
    collection.implicitRepositories.length,
    0,
    "the owner claim authorizes suppression once",
  );

  const foreignOnly = buildProjectCollection({
    projectEvents: [foreignProject],
    repositoryEvents: [repository],
  });
  assert.equal(
    foreignOnly.implicitRepositories.length,
    1,
    "a stranger cannot make a repository disappear",
  );
});

test("replaceable heads choose the lowest id on a same-second tie and owner deletes apply at the head timestamp", () => {
  const oldHead = event({ id: "f".repeat(64), content: "old" });
  const tieHead = event({ id: "0".repeat(64), content: "new" });
  const collection = buildProjectCollection({
    repositoryEvents: [oldHead, tieHead],
    projectEvents: [],
  });
  assert.equal(collection.implicitRepositories[0]?.eventId, "0".repeat(64));
  const deleted = buildProjectCollection({
    repositoryEvents: [tieHead],
    projectEvents: [],
    deletionEvents: [
      event({ kind: 5, created_at: 100, tags: [["a", REPOSITORY]] }),
    ],
  });
  assert.equal(deleted.implicitRepositories.length, 0);
});

test("work-item projections require an exact repository edge and ignore untrusted lifecycle events", () => {
  const issue = event({
    id: ISSUE_ID,
    kind: 1621,
    content: "Issue body",
    tags: [
      ["a", REPOSITORY],
      ["subject", "Fix the thing"],
    ],
  });
  const ownerStatus = event({
    id: "2".repeat(64),
    kind: 1632,
    created_at: 120,
    tags: [
      ["a", REPOSITORY],
      ["e", ISSUE_ID],
    ],
  });
  const attackerStatus = event({
    id: "3".repeat(64),
    pubkey: ATTACKER,
    kind: 1631,
    created_at: 130,
    tags: [
      ["a", REPOSITORY],
      ["e", ISSUE_ID],
    ],
  });
  const malformedComment = event({
    id: "4".repeat(64),
    kind: 1,
    tags: [
      ["a", REPOSITORY],
      ["e", ISSUE_ID],
      ["E", "5".repeat(64)],
    ],
  });
  const [workItem] = buildRepositoryWorkItems({
    repositoryAddress: REPOSITORY,
    rootEvents: [issue],
    statusEvents: [attackerStatus, ownerStatus],
    commentEvents: [malformedComment],
  });
  assert.equal(workItem?.status, "Closed");
  assert.equal(
    workItem?.comments.length,
    0,
    "ambiguous root references do not become comments",
  );
});

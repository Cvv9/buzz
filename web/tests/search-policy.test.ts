import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCHABLE_EVENT_KINDS,
  normalizeSearchFilters,
  searchDestination,
} from "../src/features/search/search-policy.ts";

const AUTHOR = "a".repeat(64);

test("NIP-50 search normalizes bounded channel, author, and time filters", () => {
  const filters = normalizeSearchFilters({
    query: "  launch notes  ",
    channelId: " engineering ",
    author: AUTHOR.toUpperCase(),
    since: "2026-08-01T10:00",
    until: "2026-08-02T10:00",
  });
  assert.equal(filters.query, "launch notes");
  assert.equal(filters.channelId, "engineering");
  assert.equal(filters.author, AUTHOR);
  assert.ok(filters.since);
  assert.ok(filters.until);
  assert.ok(SEARCHABLE_EVENT_KINDS.includes(9));
  assert.ok(SEARCHABLE_EVENT_KINDS.includes(45001));
  assert.ok(SEARCHABLE_EVENT_KINDS.includes(30621));
});

test("NIP-50 search rejects unsafe or unbounded browser input", () => {
  assert.throws(() => normalizeSearchFilters({ query: "x" }), /two characters/);
  assert.throws(
    () => normalizeSearchFilters({ query: "hello", author: "not-a-pubkey" }),
    /64-character/,
  );
  assert.throws(
    () =>
      normalizeSearchFilters({
        query: "hello",
        since: "2026-08-02T10:00",
        until: "2026-08-01T10:00",
      }),
    /before the end/,
  );
});

test("search destinations preserve the event's channel/thread or repository identity", () => {
  assert.deepEqual(
    searchDestination({
      id: "m".repeat(64),
      kind: 40002,
      pubkey: AUTHOR,
      tags: [
        ["h", "engineering"],
        ["e", "r".repeat(64), "", "root"],
      ],
    }),
    {
      kind: "workspace",
      href: `/?channel=engineering&thread=${"r".repeat(64)}`,
      label: "Open channel thread",
    },
  );
  assert.deepEqual(
    searchDestination({
      id: "repo-event",
      kind: 30617,
      pubkey: AUTHOR,
      tags: [["d", "buzz-web"]],
    }),
    { kind: "repo", href: "/repos/buzz-web", label: "Open repository" },
  );
  assert.deepEqual(
    searchDestination({
      id: "p".repeat(64),
      kind: 45003,
      pubkey: AUTHOR,
      tags: [
        ["h", "engineering"],
        ["e", "r".repeat(64), "", "root"],
        ["e", "p".repeat(64), "", "reply"],
      ],
    }),
    {
      kind: "workspace",
      href: `/channels/engineering/posts/${"r".repeat(64)}`,
      label: "Open forum post",
    },
  );
});

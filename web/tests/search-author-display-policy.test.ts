import assert from "node:assert/strict";
import test from "node:test";
import { searchAuthorDisplayName } from "../src/features/search/search-policy.ts";

const TRUNCATED = "63ea848d…da96";

test("search author label prefers a distinct profile display name", () => {
  assert.equal(searchAuthorDisplayName("Varun C", TRUNCATED), "Varun C");
  assert.equal(searchAuthorDisplayName("  Varun C  ", TRUNCATED), "Varun C");
});

test("search author label falls back to the truncated pubkey alone", () => {
  // No profile at all.
  assert.equal(searchAuthorDisplayName(undefined, TRUNCATED), null);
  // Empty or whitespace-only name.
  assert.equal(searchAuthorDisplayName("", TRUNCATED), null);
  assert.equal(searchAuthorDisplayName("   ", TRUNCATED), null);
  // A profile whose name defaulted to the truncated pubkey adds no information.
  assert.equal(searchAuthorDisplayName(TRUNCATED, TRUNCATED), null);
});

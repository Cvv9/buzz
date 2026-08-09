import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewerReplaceableHead,
  mergeProfileContent,
  parseProfileContent,
} from "../src/features/profiles/profile-policy.ts";

test("kind 0 profile edits preserve unrelated JSON fields", () => {
  const updated = mergeProfileContent(
    JSON.stringify({
      about: "Previous bio",
      picture: "https://example.test/previous.png",
      custom_field: "preserve-me",
      nip05: "member@example.test",
      website: "https://example.test",
    }),
    {
      name: "Vikram Sharma",
      picture: "https://example.test/next.png",
      about: "Updated bio",
    },
  );

  assert.deepEqual(updated, {
    display_name: "Vikram Sharma",
    name: "Vikram Sharma",
    picture: "https://example.test/next.png",
    about: "Updated bio",
    custom_field: "preserve-me",
    nip05: "member@example.test",
    website: "https://example.test",
  });
});

test("kind 0 profile edits intentionally clear browser-owned optional fields", () => {
  const updated = mergeProfileContent(
    JSON.stringify({ picture: "https://example.test/old.png", about: "Old" }),
    { name: "Vikram", picture: "", about: " " },
  );
  assert.deepEqual(updated, { display_name: "Vikram", name: "Vikram" });
});

test("malformed kind 0 content is safe to replace", () => {
  assert.deepEqual(parseProfileContent("not JSON"), {});
  assert.deepEqual(parseProfileContent("[]"), {});
});

test("replaceable profile/status heads use the lowest event id as the equal-time tie-break", () => {
  assert.equal(
    isNewerReplaceableHead(
      { created_at: 10, id: "a" },
      { created_at: 10, id: "b" },
    ),
    true,
  );
  assert.equal(
    isNewerReplaceableHead(
      { created_at: 10, id: "b" },
      { created_at: 10, id: "a" },
    ),
    false,
  );
});

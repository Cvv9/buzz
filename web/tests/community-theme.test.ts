import assert from "node:assert/strict";
import test from "node:test";
import {
  isCommunityAccent,
  isCommunityAppearance,
  isNewerCommunityThemeCoordinate,
} from "../src/shared/theme/community-theme.ts";
import {
  desktopThemeForMode,
  desktopThemesForMode,
  resolveCommunityThemeName,
} from "../src/shared/theme/desktop-theme.ts";
import {
  communityThemeOutboxKey,
  communityThemeStorageKey,
  parseCommunityThemePreference,
} from "../src/shared/theme/community-theme-preference.ts";

test("accepts only the versioned community appearance contract", () => {
  assert.equal(
    isCommunityAppearance({
      version: 1,
      theme: "buzz-dark",
      accent: "#3b82f6",
      followSystem: false,
    }),
    true,
  );
  assert.equal(
    isCommunityAppearance({
      version: 1,
      theme: "github-light",
      accent: "neutral",
      followSystem: false,
    }),
    true,
  );

  for (const invalid of [
    null,
    { version: 2, theme: "buzz", accent: "#3b82f6", followSystem: true },
    { version: 1, theme: "", accent: "#3b82f6", followSystem: true },
    {
      version: 1,
      theme: "not-a-desktop-theme",
      accent: "#3b82f6",
      followSystem: true,
    },
    { version: 1, theme: "buzz", accent: "blue", followSystem: true },
    {
      version: 1,
      theme: "buzz",
      accent: "#123456",
      followSystem: true,
    },
    { version: 1, theme: "buzz", accent: "#3b82f6", followSystem: "yes" },
  ]) {
    assert.equal(isCommunityAppearance(invalid), false);
  }
});

test("selects the newest encrypted appearance deterministically", () => {
  const first = { createdAt: 100, eventId: "b".repeat(64) };
  assert.equal(
    isNewerCommunityThemeCoordinate(
      { createdAt: 101, eventId: "f".repeat(64) },
      first,
    ),
    true,
  );
  assert.equal(
    isNewerCommunityThemeCoordinate(
      { createdAt: 99, eventId: "a".repeat(64) },
      first,
    ),
    false,
  );
  assert.equal(
    isNewerCommunityThemeCoordinate(
      { createdAt: 100, eventId: "a".repeat(64) },
      first,
    ),
    true,
  );
});

test("uses only desktop-selectable accents and theme families", () => {
  assert.equal(isCommunityAccent("#3b82f6"), true);
  assert.equal(isCommunityAccent("#123456"), false);
  assert.deepEqual(
    parseCommunityThemePreference({
      version: 1,
      theme: "github-dark",
      accent: "#ec4899",
      followSystem: false,
    }),
    {
      version: 1,
      theme: "github-dark",
      accent: "#ec4899",
      followSystem: false,
    },
  );
});

test("keeps a paired theme family while changing light, dark, and system modes", () => {
  assert.equal(desktopThemeForMode("github-light", "dark"), "github-dark");
  assert.equal(desktopThemeForMode("github-dark", "system"), "github-light");
  assert.equal(desktopThemeForMode("dracula", "light"), "buzz");
  assert.equal(desktopThemesForMode("system").includes("github-light"), true);
  assert.equal(desktopThemesForMode("system").includes("github-dark"), false);
});

test("scopes local preference and outbox keys to identity and normalized relay", () => {
  const first = communityThemeStorageKey("ALICE", "wss://relay.example/");
  assert.equal(first, communityThemeStorageKey("alice", "wss://relay.example"));
  assert.notEqual(
    first,
    communityThemeStorageKey("bob", "wss://relay.example"),
  );
  assert.notEqual(
    first,
    communityThemeStorageKey("alice", "wss://other.example"),
  );
  assert.notEqual(
    first,
    communityThemeOutboxKey("alice", "wss://relay.example"),
  );
});

test("uses the desktop catalog for non-Buzz light and dark themes", () => {
  assert.equal(
    resolveCommunityThemeName(
      {
        version: 1,
        theme: "github-light",
        accent: "#3b82f6",
        followSystem: true,
      },
      true,
    ),
    "github-dark",
  );
  assert.equal(
    resolveCommunityThemeName(
      {
        version: 1,
        theme: "dracula",
        accent: "#3b82f6",
        followSystem: false,
      },
      false,
    ),
    "dracula",
  );
});

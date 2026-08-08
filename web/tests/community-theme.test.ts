import assert from "node:assert/strict";
import test from "node:test";
import {
  isCommunityAppearance,
  isNewerCommunityThemeCoordinate,
} from "../src/shared/theme/community-theme.ts";
import { resolveCommunityThemeName } from "../src/shared/theme/desktop-theme.ts";

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
    { version: 1, theme: "buzz", accent: "blue", followSystem: true },
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

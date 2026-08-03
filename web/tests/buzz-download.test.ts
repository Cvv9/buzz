import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BUZZ_RELEASES_REPOSITORY,
  resolveBuzzReleaseSource,
} from "../src/shared/lib/buzz-download.ts";

test("uses the upstream release channel when no repository is configured", () => {
  assert.deepEqual(resolveBuzzReleaseSource(undefined), {
    repository: DEFAULT_BUZZ_RELEASES_REPOSITORY,
    releasesUrl: "https://github.com/block/buzz/releases",
    releasesApiUrl:
      "https://api.github.com/repos/block/buzz/releases?per_page=10",
  });
});

test("uses a configured fork release channel", () => {
  assert.deepEqual(resolveBuzzReleaseSource("Cvv9/buzz"), {
    repository: "Cvv9/buzz",
    releasesUrl: "https://github.com/Cvv9/buzz/releases",
    releasesApiUrl:
      "https://api.github.com/repos/Cvv9/buzz/releases?per_page=10",
  });
});

test("rejects malformed release repositories", () => {
  for (const invalidRepository of [
    "",
    "block",
    "https://example.invalid/releases",
    "block/buzz/releases",
    "block/buzz?redirect=https://example.invalid",
  ]) {
    assert.equal(
      resolveBuzzReleaseSource(invalidRepository).repository,
      DEFAULT_BUZZ_RELEASES_REPOSITORY,
    );
  }
});

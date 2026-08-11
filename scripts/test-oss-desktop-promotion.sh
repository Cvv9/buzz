#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="$root/.github/workflows/promote-oss-desktop-release.yml"
promoter="$root/scripts/promote-oss-desktop-release.sh"
release="$root/.github/workflows/release.yml"

# Tag builds retain the exact candidate and then advance this repository's
# rolling updater only after the stable, tag-bound release is public.
grep -Fq 'cp latest.json staged/updater-manifest.json' "$release"
grep -Fq 'Validate stable updater promotion source' "$release"
grep -Fq 'rolling updater promotion requires stable semver X.Y.Z' "$release"
grep -Fq 'RELEASE_REPOSITORY: ${{ github.repository }}' "$release"
grep -Fq 'gh release upload buzz-desktop-latest latest.json --repo "$RELEASE_REPOSITORY" --clobber' "$release"
[[ "$(grep -c 'gh release upload' "$release")" -eq 2 ]]

grep -Fq 'workflow_dispatch:' "$workflow"
grep -Fq 'group: oss-desktop-auto-update-promotion' "$workflow"
grep -Fq 'cancel-in-progress: false' "$workflow"
grep -Fq 'DISPATCH_REF' "$workflow"
grep -Fq 'contents: write' "$workflow"
grep -Fq 'VERSION: ${{ inputs.version }}' "$workflow"
grep -Fq 'scripts/promote-oss-desktop-release.sh "$VERSION"' "$workflow"
! grep -Fq 'block/buzz' "$workflow"
if grep -F 'run:' "$workflow" | grep -Fq '${{ inputs.version }}'; then
  echo "untrusted workflow input must not be interpolated into run" >&2
  exit 1
fi

grep -Fq 'refusing downgrade' "$promoter"
grep -Fq 'current_digest="$(sha256sum "$current"' "$promoter"
grep -Fq '== "$current_digest"' "$promoter"
grep -Fq 'updater-manifest.json' "$promoter"
grep -Fq 'REPOSITORY="${GITHUB_REPOSITORY:-}"' "$promoter"
grep -Fq 'RELEASE_DOWNLOAD_BASE="https://github.com/${REPOSITORY}/releases/download"' "$promoter"
grep -Fq -- '--arg base "${RELEASE_DOWNLOAD_BASE}/${TAG}"' "$promoter"
grep -Fq 'gh release upload "$ROLLING_TAG" "$promotion"' "$promoter"
grep -Fq 'served latest.json does not match the promoted candidate' "$promoter"
grep -Fq 'promotion upload failed' "$promoter"
! grep -Fq 'block/buzz' "$promoter"

echo "desktop updater release contract passed"

#!/usr/bin/env bash
# Verify GitHub-side prerequisites for the VarVik desktop release channel.
#
# This script only reads repository metadata and secret/variable names. It never
# prints secret values, creates tags/releases, or mutates GitHub configuration.
set -euo pipefail

repository="${VARVIK_RELEASE_REPOSITORY:-Cvv9/buzz}"
failures=0

need_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 2
  }
}

require_name() {
  local category="$1" name="$2" available="$3"
  if ! grep -Fxq "$name" <<<"$available"; then
    echo "missing $category: $name" >&2
    failures=1
  fi
}

need_command gh

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated" >&2
  exit 2
fi

repo_name="$(gh repo view "$repository" --json nameWithOwner --jq .nameWithOwner)"
permission="$(gh repo view "$repository" --json viewerPermission --jq .viewerPermission)"
if [[ "$repo_name" != "$repository" ]]; then
  echo "resolved repository '$repo_name' does not match '$repository'" >&2
  exit 2
fi
if [[ "$permission" != "ADMIN" && "$permission" != "MAINTAIN" ]]; then
  echo "release setup needs ADMIN or MAINTAIN permission; current permission: $permission" >&2
  failures=1
fi

actions_enabled="$(gh api "repos/$repository/actions/permissions" --jq .enabled)"
if [[ "$actions_enabled" != "true" ]]; then
  echo "GitHub Actions is disabled for $repository" >&2
  failures=1
fi

if grep -Fq "github.com/block/buzz/releases/download" .github/workflows/release.yml; then
  echo "release workflow still publishes updater URLs under block/buzz" >&2
  failures=1
fi

secret_names="$(gh secret list --repo "$repository" --json name --jq '.[].name')"
variable_names="$(gh variable list --repo "$repository" --json name --jq '.[].name')"

# Tauri artifact signing. The public key is embedded in every release build;
# the matching private key must remain stable for the entire update channel.
for name in \
  BUZZ_UPDATER_PUBLIC_KEY \
  TAURI_SIGNING_PRIVATE_KEY \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  APPLE_CERTIFICATE_BASE64 \
  APPLE_CERTIFICATE_PASSWORD \
  APPLE_API_KEY_BASE64; do
  require_name secret "$name" "$secret_names"
done

# These values identify release infrastructure but are not private key
# material. Keeping them as repository variables makes the release workflow
# portable without embedding VarVik account identifiers in source.
for name in \
  APPLE_SIGNING_IDENTITY \
  APPLE_TEAM_ID \
  APPLE_API_KEY_ID \
  APPLE_API_ISSUER_ID; do
  require_name variable "$name" "$variable_names"
done

if ! gh release view buzz-desktop-latest --repo "$repository" >/dev/null 2>&1; then
  echo "missing rolling updater release: buzz-desktop-latest" >&2
  failures=1
fi

if (( failures != 0 )); then
  echo >&2
  echo "VarVik desktop release channel is not ready. See docs/varvik-desktop-release.md." >&2
  exit 1
fi

echo "VarVik desktop release prerequisites are present for $repository."

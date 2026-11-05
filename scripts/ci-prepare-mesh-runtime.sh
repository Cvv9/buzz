#!/usr/bin/env bash
# Build the CPU inference runtime from the same immutable source as the smoke SDK.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${RUNNER_TEMP:?This helper requires an isolated CI runner directory}"
: "${GITHUB_ENV:?This helper exports the verified bundle to later CI steps}"
[[ "$(uname -s)/$(uname -m)" == "Linux/x86_64" ]]

revision="$(python3 - "$REPO_ROOT" <<'PY'
import pathlib
import re
import sys
import tomllib

root = pathlib.Path(sys.argv[1])
manifest = tomllib.loads((root / "crates/buzz-mesh-smoke/Cargo.toml").read_text())
dependencies = manifest["dev-dependencies"]
sdk = dependencies["mesh-llm-sdk"]
host = dependencies["mesh-llm-host-runtime"]
repository = "https://github.com/Mesh-LLM/mesh-llm.git"
revision = sdk["rev"]
assert re.fullmatch(r"[0-9a-f]{40}", revision), "SDK must use an immutable commit"
assert sdk["git"] == host["git"] == repository
assert host["rev"] == revision, "SDK and host runtime pins disagree"
lock = tomllib.loads((root / "Cargo.lock").read_text())
for name in ("mesh-llm-sdk", "mesh-llm-host-runtime"):
    packages = [p for p in lock["package"] if p["name"] == name]
    assert len(packages) == 1
    assert packages[0]["source"] == f"git+{repository}?rev={revision}#{revision}"
print(revision)
PY
)"

source_dir="$(mktemp -d "$RUNNER_TEMP/mesh-runtime-source.XXXXXX")"
git -C "$source_dir" init --quiet
git -C "$source_dir" fetch --depth=1 https://github.com/Mesh-LLM/mesh-llm.git "$revision"
git -C "$source_dir" checkout --detach FETCH_HEAD
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$revision" ]]

cd "$source_dir"
# Use only the upstream locked automation binary and CPU package builder.
# No application or GPU backend is built. Keep Cargo outputs isolated from Buzz.
export CARGO_TARGET_DIR="$source_dir/target"
export RUSTC_WRAPPER=""
cargo build --locked -p xtask --bin xtask
export MESH_LLM_AUTOMATION_BIN="$CARGO_TARGET_DIR/debug/xtask"
bundle="$(scripts/ci-prepare-native-runtime.sh "$source_dir/dist/ci-runtime" cpu)"
[[ "$bundle" == "$source_dir/"* && -f "$bundle/manifest.json" ]]
# The upstream helper verifies the package; SDK discovery still enforces its ABI.
printf 'MESH_LLM_NATIVE_RUNTIME_BUNDLE_DIR=%s\n' "$bundle" >> "$GITHUB_ENV"

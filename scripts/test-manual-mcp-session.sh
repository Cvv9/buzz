#!/bin/sh
set -eu
# Read-only MCP discovery in the actual UID1002 ACP/native session, no model turn.
image=${1:?image required}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config=${2:-$root/deploy/compose/tests/fixtures/manual-mcp.toml}
docker run --rm --init --platform linux/amd64 --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=128m \
  --tmpfs /home/buzz-manual:rw,nosuid,nodev,mode=0700,size=256m \
  --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --cap-add SETUID --cap-add SETGID --cap-add KILL --security-opt no-new-privileges \
  -v "$root/deploy/compose/tests:/tests:ro" -v "$config:/manual-config.toml:ro" \
  --entrypoint node "$image" /tests/manual-mcp-session-smoke.mjs

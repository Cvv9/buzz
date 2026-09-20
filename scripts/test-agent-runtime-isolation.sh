#!/bin/sh
# Use the final published candidate image before promotion. A runtime-base
# image checks packaging only and is not final Rust runner release evidence.
set -eu
image=${1:?usage: test-agent-runtime-isolation.sh IMAGE}
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
docker run --rm --platform linux/amd64 --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  --tmpfs /home/node:rw,nosuid,nodev,size=256m \
  --tmpfs /home/buzz-manual:rw,nosuid,nodev,size=256m \
  --tmpfs /var/lib/buzz-harness:rw,nosuid,nodev,size=16m \
  --tmpfs /run/buzz-auth:rw,nosuid,nodev,size=1m \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  --cap-add SETUID --cap-add SETGID --cap-add KILL \
  --security-opt no-new-privileges:true \
  -v "$root/deploy/compose/tests:/smoke:ro" \
  --entrypoint node "$image" /smoke/agent-isolation-smoke.mjs

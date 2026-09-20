#!/bin/sh
# Root-only initialization. No agent or provider subprocess runs in this phase.
set -eu
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Agent runtime initialization requires root' >&2; exit 1; }
for path in /var/lib/buzz-harness /home/node /home/node/.codex /home/buzz-manual; do
  [ ! -L "$path" ] || { echo 'Agent state directory must not be a symlink' >&2; exit 1; }
done
install -d -m 0700 -o 1001 -g 1001 /var/lib/buzz-harness /var/lib/buzz-harness/workflow-runs
install -d -m 0700 -o 1000 -g 1000 /home/node /home/node/.codex
install -d -m 0700 -o 1002 -g 1002 /home/buzz-manual /home/buzz-manual/.codex /home/buzz-manual/workspace
exec 9>/var/lib/buzz-harness/.init.lock
flock -x 9
identity=/var/lib/buzz-harness/identity.env
legacy=/home/node/.codex/varvik-agent-identity.env
for path in "$identity" "$legacy"; do
  [ ! -L "$path" ] || { echo 'Agent identity must not be a symlink' >&2; exit 1; }
  [ ! -e "$path" ] || [ -f "$path" ] || { echo 'Agent identity must be a regular file' >&2; exit 1; }
done
if [ -s "$legacy" ]; then
  if [ -s "$identity" ]; then
    cmp -s "$legacy" "$identity" || { echo 'Conflicting protected and legacy identities; refusing rotation' >&2; exit 1; }
  else
    install -o 1001 -g 1001 -m 0600 "$legacy" "$identity"
  fi
  # Migration is complete only once no full Buzz key remains in worker HOME.
  rm -f "$legacy"
fi
if [ ! -s "$identity" ]; then
  if [ -z "${BUZZ_PRIVATE_KEY:-}" ] && [ -z "${VARVIK_AGENT_PUBKEY:-}" ]; then
    keypair="$(buzz-admin generate-key)"
    VARVIK_AGENT_PUBKEY="$(printf '%s\n' "$keypair" | sed -n 's/^Public key:[[:space:]]*//p')"
    BUZZ_PRIVATE_KEY="$(printf '%s\n' "$keypair" | sed -n 's/^Secret key:[[:space:]]*//p')"
    unset keypair
  fi
  printf '%s' "${VARVIK_AGENT_PUBKEY:-}" | grep -Eq '^[0-9a-f]{64}$' || { echo 'Invalid agent public identity' >&2; exit 1; }
  printf '%s' "${BUZZ_PRIVATE_KEY:-}" | grep -Eq '^[0-9a-f]{64}$' || { echo 'Invalid agent private identity' >&2; exit 1; }
  temp_identity="$(mktemp /var/lib/buzz-harness/identity.XXXXXX)"
  trap 'rm -f "$temp_identity"' EXIT HUP INT TERM
  printf 'VARVIK_AGENT_PUBKEY=%s\nBUZZ_PRIVATE_KEY=%s\n' "$VARVIK_AGENT_PUBKEY" "$BUZZ_PRIVATE_KEY" >"$temp_identity"
  chown 1001:1001 "$temp_identity"
  chmod 0600 "$temp_identity"
  mv "$temp_identity" "$identity"
  trap - EXIT HUP INT TERM
fi
chown 1001:1001 "$identity"
chmod 0600 "$identity"
# The provisioner needs only this public value; never source or print the key.
sed -n 's/^VARVIK_AGENT_PUBKEY=\([0-9a-f]\{64\}\)$/\1/p' "$identity"

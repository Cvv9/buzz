#!/bin/sh
set -eu

: "${BUZZ_ACP_DISPLAY_NAME:=VarVik AI}"
: "${BUZZ_ACP_PROFILE_ABOUT:=Hosted AI collaborator for the VarVik Studios community}"

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /home/node/.codex
  chown node:node /home/node/.codex
  if [ -f /run/secrets/varvik-codex-auth.json ] && [ ! -s /home/node/.codex/auth.json ]; then
    install -o node -g node -m 600 /run/secrets/varvik-codex-auth.json /home/node/.codex/auth.json
  fi
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

if [ -f /run/secrets/varvik-codex-auth.json ] && [ ! -s "${HOME}/.codex/auth.json" ]; then
  mkdir -p "${HOME}/.codex"
  install -m 600 /run/secrets/varvik-codex-auth.json "${HOME}/.codex/auth.json"
fi

# Keep one stable Nostr identity per named agent volume. Explicit environment
# values remain supported for migrations and externally managed identities.
: "${BUZZ_AGENT_KEY_FILE:=${HOME}/.codex/varvik-agent-identity.env}"
if [ -r "${BUZZ_AGENT_KEY_FILE}" ]; then
  VARVIK_AGENT_PUBKEY="$(sed -n 's/^VARVIK_AGENT_PUBKEY=\([0-9a-f]\{64\}\)$/\1/p' "${BUZZ_AGENT_KEY_FILE}")"
  BUZZ_PRIVATE_KEY="$(sed -n 's/^BUZZ_PRIVATE_KEY=\([0-9a-f]\{64\}\)$/\1/p' "${BUZZ_AGENT_KEY_FILE}")"
fi

if [ -z "${BUZZ_PRIVATE_KEY:-}" ] && [ -z "${VARVIK_AGENT_PUBKEY:-}" ]; then
  keypair="$(buzz-admin generate-key)"
  VARVIK_AGENT_PUBKEY="$(printf '%s\n' "${keypair}" | sed -n 's/^Public key:[[:space:]]*//p')"
  BUZZ_PRIVATE_KEY="$(printf '%s\n' "${keypair}" | sed -n 's/^Secret key:[[:space:]]*//p')"
fi

if ! printf '%s' "${VARVIK_AGENT_PUBKEY:-}" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "VARVIK_AGENT_PUBKEY must be a 64-character lowercase hex key" >&2
  exit 1
fi
if ! printf '%s' "${BUZZ_PRIVATE_KEY:-}" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "BUZZ_PRIVATE_KEY must be a 64-character lowercase hex key" >&2
  exit 1
fi

if [ ! -s "${BUZZ_AGENT_KEY_FILE}" ]; then
  umask 077
  {
    printf 'VARVIK_AGENT_PUBKEY=%s\n' "${VARVIK_AGENT_PUBKEY}"
    printf 'BUZZ_PRIVATE_KEY=%s\n' "${BUZZ_PRIVATE_KEY}"
  } >"${BUZZ_AGENT_KEY_FILE}"
fi
export VARVIK_AGENT_PUBKEY BUZZ_PRIVATE_KEY

# Idempotent relay membership bootstrap. The command exits successfully when
# the member already exists.
buzz-admin add-member --pubkey "${VARVIK_AGENT_PUBKEY}" --role member

# Agent-authored discovery profile used by browser and desktop clients.
buzz agents publish-profile \
  --display-name "${BUZZ_ACP_DISPLAY_NAME}" \
  --about "${BUZZ_ACP_PROFILE_ABOUT}"

exec buzz-acp

#!/bin/sh
set -eu

umask 077

: "${BUZZ_RUNTIME_CONTROLLER_RELAY_URL:?set BUZZ_RUNTIME_CONTROLLER_RELAY_URL}"
: "${BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY:?set BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY}"
: "${BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY:?set BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY}"
: "${RELAY_OWNER_PUBKEY:?set RELAY_OWNER_PUBKEY}"
: "${BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON:?set BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON}"

case "${BUZZ_RUNTIME_CONTROLLER_RELAY_URL}" in
  ws://*|wss://*) ;;
  *) echo "BUZZ_RUNTIME_CONTROLLER_RELAY_URL must use ws or wss" >&2; exit 1 ;;
esac
if ! printf '%s' "${BUZZ_RUNTIME_CONTROLLER_RELAY_URL}" | grep -Eq '^[A-Za-z0-9:/?&=._~%+@-]+$'; then
  echo "BUZZ_RUNTIME_CONTROLLER_RELAY_URL contains unsupported characters" >&2
  exit 1
fi

for public_key in "${BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY}" "${RELAY_OWNER_PUBKEY}"; do
  if ! printf '%s' "${public_key}" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "Controller and owner public keys must be lowercase 64-character hex" >&2
    exit 1
  fi
done
if ! printf '%s' "${BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY}" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "Controller private key must be 64-character hex" >&2
  exit 1
fi

state_dir="${BUZZ_RUNTIME_CONTROLLER_STATE_DIR:-/var/lib/buzz-runtime-controller}"
case "${state_dir}" in
  /*) ;;
  *) echo "BUZZ_RUNTIME_CONTROLLER_STATE_DIR must be absolute" >&2; exit 1 ;;
esac
if ! printf '%s' "${state_dir}" | grep -Eq '^/[A-Za-z0-9_./-]+$'; then
  echo "BUZZ_RUNTIME_CONTROLLER_STATE_DIR contains unsupported characters" >&2
  exit 1
fi
config_path="${state_dir}/controller-config.json"
temp_path="${config_path}.tmp"
mkdir -p "${state_dir}"
chmod 700 "${state_dir}"

printf '{"relay_url":"%s","controller_private_key":"%s","controller_pubkey":"%s","owner_pubkey":"%s","state_path":"%s/state.json","audit_path":"%s/audit.jsonl","agents":%s}\n' \
  "${BUZZ_RUNTIME_CONTROLLER_RELAY_URL}" \
  "${BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY}" \
  "${BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY}" \
  "${RELAY_OWNER_PUBKEY}" \
  "${state_dir}" \
  "${state_dir}" \
  "${BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON}" >"${temp_path}"
chmod 600 "${temp_path}"
mv -f "${temp_path}" "${config_path}"

export BUZZ_RUNTIME_CONTROLLER_CONFIG="${config_path}"
unset BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON

/usr/local/bin/buzz-runtime-controller --check-config

if [ "${BUZZ_RUNTIME_CONTROLLER_CONFIG_ONLY:-false}" = "true" ]; then
  exit 0
fi

exec /usr/local/bin/buzz-runtime-controller

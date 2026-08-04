#!/bin/sh
set -eu

: "${BUZZ_ACP_DISPLAY_NAME:=VarVik Guide}"
: "${BUZZ_ACP_PROFILE_ABOUT:=Hosted AI collaborator for the VarVik Studios community}"
: "${BUZZ_ACP_PROFILE_AUDIENCE:=community}"
: "${BUZZ_ACP_PROFILE_ACCESS_TIER:=shared}"
: "${BUZZ_ACP_CHANNEL_ADD_POLICY:=anyone}"

if [ -r /etc/buzz/agent-safety-policy.md ]; then
  safety_policy="$(cat /etc/buzz/agent-safety-policy.md)"
  if [ -n "${BUZZ_ACP_TEAM_INSTRUCTIONS:-}" ]; then
    BUZZ_ACP_TEAM_INSTRUCTIONS="${safety_policy}

${BUZZ_ACP_TEAM_INSTRUCTIONS}"
  else
    BUZZ_ACP_TEAM_INSTRUCTIONS="${safety_policy}"
  fi
  export BUZZ_ACP_TEAM_INSTRUCTIONS
fi

case "${BUZZ_ACP_PROFILE_AUDIENCE}" in
  community) ;;
  owner)
    if ! printf '%s' "${BUZZ_ACP_PROFILE_OWNER_PUBKEY:-}" | grep -Eq '^[0-9a-f]{64}$'; then
      echo "BUZZ_ACP_PROFILE_OWNER_PUBKEY must be set for an owner-only agent" >&2
      exit 1
    fi
    ;;
  *)
    echo "BUZZ_ACP_PROFILE_AUDIENCE must be community or owner" >&2
    exit 1
    ;;
esac

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

# Ask the configured ACP adapter for its model catalog before publishing the
# hosted directory entry. This keeps Desktop's per-agent picker capability-
# driven: Claude, Codex, and future adapters each advertise their own options
# instead of the UI maintaining a stale provider table.
if [ -z "${BUZZ_ACP_PROFILE_MODELS_JSON:-}" ]; then
  raw_models="$(buzz-acp models --json 2>/dev/null || true)"
  BUZZ_ACP_PROFILE_MODELS_JSON="$(printf '%s' "${raw_models}" | node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(input);
        const found = new Map();
        for (const config of payload?.stable?.configOptions ?? []) {
          for (const option of config?.options ?? []) {
            if (typeof option?.value === "string") {
              found.set(option.value, {
                id: option.value,
                name: typeof option.displayName === "string" ? option.displayName : null,
              });
            }
          }
        }
        for (const option of payload?.unstable?.availableModels ?? []) {
          if (typeof option?.modelId === "string" && !found.has(option.modelId)) {
            found.set(option.modelId, {
              id: option.modelId,
              name: typeof option.name === "string" ? option.name : null,
            });
          }
        }
        process.stdout.write(JSON.stringify([...found.values()]));
      } catch {
        process.stdout.write("[]");
      }
    });
  ')"
fi
export BUZZ_ACP_PROFILE_MODELS_JSON

# Local single-host bundles may let the agent perform its own idempotent member
# bootstrap. Managed deployments pre-register public keys with the relay and
# disable this step so agent containers never receive relay-administrator
# credentials.
if [ "${BUZZ_ACP_SKIP_MEMBER_BOOTSTRAP:-false}" != "true" ]; then
  buzz-admin add-member --pubkey "${VARVIK_AGENT_PUBKEY}" --role member
fi

if [ -n "${BUZZ_ACP_PRIVATE_CHANNEL_NAME:-}" ]; then
  if ! printf '%s' "${BUZZ_ACP_PROFILE_OWNER_PUBKEY:-}" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "A private agent channel requires BUZZ_ACP_PROFILE_OWNER_PUBKEY" >&2
    exit 1
  fi

  channel_search="$(buzz channels search \
    --query "${BUZZ_ACP_PRIVATE_CHANNEL_NAME}" --exact --limit 1000)"
  private_channel_id="$(printf '%s' "${channel_search}" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const rows = JSON.parse(input);
      process.stdout.write(rows[0]?.channel_id || "");
    });
  ')"

  if [ -z "${private_channel_id}" ]; then
    created_channel="$(buzz channels create \
      --name "${BUZZ_ACP_PRIVATE_CHANNEL_NAME}" \
      --type stream \
      --visibility private \
      --description "${BUZZ_ACP_PRIVATE_CHANNEL_DESCRIPTION:-Private daily brief and personal assistant channel}")"
    private_channel_id="$(printf '%s' "${created_channel}" | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const row = JSON.parse(input);
        process.stdout.write(row.channel_id || "");
      });
    ')"
  fi

  if ! printf '%s' "${private_channel_id}" | grep -Eq '^[0-9a-fA-F-]{36}$'; then
    echo "Could not resolve the private channel ${BUZZ_ACP_PRIVATE_CHANNEL_NAME}" >&2
    exit 1
  fi

  buzz channels add-member \
    --channel "${private_channel_id}" \
    --pubkey "${BUZZ_ACP_PROFILE_OWNER_PUBKEY}" \
    --role owner

  # Personal agents subscribe only to their private channel. Their scheduled
  # work also writes only to this channel.
  BUZZ_ACP_CHANNELS="${private_channel_id}"
  : "${BUZZ_ACP_HEARTBEAT_INTERVAL:=86400}"
  : "${BUZZ_ACP_BRIEF_UTC_HOUR:=3}"
  : "${BUZZ_ACP_BRIEF_UTC_MINUTE:=30}"
  if [ -z "${BUZZ_ACP_HEARTBEAT_INITIAL_DELAY:-}" ]; then
    now_hour="$(date -u +%H)"
    now_minute="$(date -u +%M)"
    now_second="$(date -u +%S)"
    now_hour="${now_hour#0}"
    now_minute="${now_minute#0}"
    now_second="${now_second#0}"
    now_of_day=$((now_hour * 3600 + now_minute * 60 + now_second))
    target_of_day=$((BUZZ_ACP_BRIEF_UTC_HOUR * 3600 + BUZZ_ACP_BRIEF_UTC_MINUTE * 60))
    first_delay=$((target_of_day - now_of_day))
    if [ "${first_delay}" -le 0 ]; then
      first_delay=$((first_delay + 86400))
    fi
    BUZZ_ACP_HEARTBEAT_INITIAL_DELAY="${first_delay}"
  fi
  : "${BUZZ_ACP_HEARTBEAT_PROMPT:=Prepare the private morning brief for ${BUZZ_ACP_PROFILE_MEMBER_NAME:-your owner}. Check only information this person is allowed to access. Summarize assigned work, overdue items, blockers, pull requests needing attention, Buzz mentions, deadlines, and clear next actions. If a source is not connected, say so plainly and do not invent data. Post exactly one concise brief to channel ${private_channel_id}. Never post this brief anywhere else.}"
  export BUZZ_ACP_CHANNELS BUZZ_ACP_HEARTBEAT_INTERVAL
  export BUZZ_ACP_HEARTBEAT_INITIAL_DELAY BUZZ_ACP_HEARTBEAT_PROMPT
fi

# Publish profile and channel-add policy in one replaceable event. Keeping them
# together prevents same-second startup writes from racing each other.
if [ -n "${BUZZ_ACP_PROFILE_OWNER_PUBKEY:-}" ]; then
  set -- buzz agents publish-profile \
    --display-name "${BUZZ_ACP_DISPLAY_NAME}" \
    --about "${BUZZ_ACP_PROFILE_ABOUT}" \
    --audience "${BUZZ_ACP_PROFILE_AUDIENCE}" \
    --access-tier "${BUZZ_ACP_PROFILE_ACCESS_TIER}" \
    --channel-add-policy "${BUZZ_ACP_CHANNEL_ADD_POLICY}" \
    --owner-pubkey "${BUZZ_ACP_PROFILE_OWNER_PUBKEY}"
else
  set -- buzz agents publish-profile \
    --display-name "${BUZZ_ACP_DISPLAY_NAME}" \
    --about "${BUZZ_ACP_PROFILE_ABOUT}" \
    --audience "${BUZZ_ACP_PROFILE_AUDIENCE}" \
    --access-tier "${BUZZ_ACP_PROFILE_ACCESS_TIER}" \
    --channel-add-policy "${BUZZ_ACP_CHANNEL_ADD_POLICY}"
fi

if [ -n "${BUZZ_ACP_PROFILE_AVATAR:-}" ]; then
  set -- "$@" --avatar "${BUZZ_ACP_PROFILE_AVATAR}"
fi
if [ -n "${BUZZ_ACP_PROFILE_ALIASES:-}" ]; then
  set -- "$@" --aliases "${BUZZ_ACP_PROFILE_ALIASES}"
fi
set -- "$@" --models-json "${BUZZ_ACP_PROFILE_MODELS_JSON:-[]}"
if [ -n "${BUZZ_ACP_MODEL:-}" ]; then
  set -- "$@" --model "${BUZZ_ACP_MODEL}"
fi

"$@"

exec buzz-acp

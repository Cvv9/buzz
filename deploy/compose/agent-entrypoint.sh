#!/bin/sh
set -eu

normalize_codex_api_key() {
  if [ -z "${OPENAI_API_KEY:-}" ] && [ -n "${CODEX_API_KEY:-}" ]; then
    export OPENAI_API_KEY="${CODEX_API_KEY}"
  fi
}

prepare_codex_auth() {
  ordinary_home=$1
  manual_home=$2
  auth_source=$3
  if [ -n "${OPENAI_API_KEY:-}" ]; then
    rm -f "${ordinary_home}/.codex/auth.json" "${manual_home}/.codex/auth.json"
  elif [ -s "${auth_source}" ]; then
    install -o 1000 -g 1000 -m 600 "${auth_source}" "${ordinary_home}/.codex/auth.json"
    install -o 1002 -g 1002 -m 600 "${auth_source}" "${manual_home}/.codex/auth.json"
  fi
}

extract_profile_model_catalog() {
  field="${1:-all}"
  node -e '
    const field = process.argv[1];
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(input);
        const canonical = payload?.canonical;
        const models = Array.isArray(canonical?.compatibility_models)
          ? canonical.compatibility_models
              .filter(model => typeof model?.id === "string" && typeof model?.name === "string")
              .map(model => ({ id: model.id, name: model.name }))
          : [];
        const modelFamilies = Array.isArray(canonical?.catalog?.model_families)
          ? canonical.catalog.model_families
          : [];
        const catalogDigest = typeof canonical?.digest === "string" ? canonical.digest : null;
        const result = { models, model_families: modelFamilies, catalog_digest: catalogDigest };
        const fallback = field === "catalog_digest" ? null : [];
        process.stdout.write(JSON.stringify(field === "all" ? result : result[field] ?? fallback));
      } catch {
        process.stdout.write(field === "all" ? "{\"models\":[],\"model_families\":[],\"catalog_digest\":null}" : (field === "catalog_digest" ? "null" : "[]"));
      }
    });
  ' "${field}"
}

# Test hook: exercise the production extractor without starting an agent or
# touching identity state. The normal startup path below calls the same
# function, so fixtures cannot accidentally validate a different parser.
if [ "${BUZZ_AGENT_ENTRYPOINT_MODELS_ONLY:-false}" = "true" ]; then
  extract_profile_model_catalog
  exit 0
fi

# Optional API-billed failover when the ChatGPT subscription hits its usage
# limit: points BUZZ_ACP_FAILOVER_ENV at a MODEL_PROVIDER/CODEX_CONFIG pair
# that defines the azure-foundry provider inline via CODEX_CONFIG's
# `model_providers` map. This deliberately never touches `~/.codex/config.toml`:
# production mounts that file read-only from the host, and the container
# filesystem itself is read-only, so writing to it would crash the agent
# under `set -eu`. The published codex-acp adapter always spawns
# `codex app-server` as a bare command — it does not accept `-c`/`--config`/
# `-m` flags — so the provider switch must go through env vars
# (MODEL_PROVIDER, CODEX_CONFIG), not `BUZZ_ACP_FAILOVER_AGENT_ARGS`.
# No-op unless all three AZURE_FOUNDRY_* vars are set; a partial set is a
# misconfiguration.
configure_provider_failover() {
  set_count=0
  [ -n "${AZURE_FOUNDRY_API_KEY:-}" ] && set_count=$((set_count + 1))
  [ -n "${AZURE_FOUNDRY_BASE_URL:-}" ] && set_count=$((set_count + 1))
  [ -n "${AZURE_FOUNDRY_DEPLOYMENT:-}" ] && set_count=$((set_count + 1))

  if [ "${set_count}" -eq 0 ]; then
    return 0
  fi
  if [ "${set_count}" -ne 3 ]; then
    echo "AZURE_FOUNDRY_API_KEY, AZURE_FOUNDRY_BASE_URL, and AZURE_FOUNDRY_DEPLOYMENT must all be set together for provider failover (or all left empty)" >&2
    exit 1
  fi

  if ! printf '%s' "${AZURE_FOUNDRY_BASE_URL}" | grep -Eq '^https://'; then
    echo "AZURE_FOUNDRY_BASE_URL must start with https://" >&2
    exit 1
  fi
  if ! printf '%s' "${AZURE_FOUNDRY_DEPLOYMENT}" | grep -Eq '^[A-Za-z0-9._-]+$'; then
    echo "AZURE_FOUNDRY_DEPLOYMENT must match ^[A-Za-z0-9._-]+\$" >&2
    exit 1
  fi
  if [ -n "${AZURE_FOUNDRY_API_VERSION:-}" ] &&
    ! printf '%s' "${AZURE_FOUNDRY_API_VERSION}" | grep -Eq '^[A-Za-z0-9._-]+$'; then
    echo "AZURE_FOUNDRY_API_VERSION must match ^[A-Za-z0-9._-]+\$" >&2
    exit 1
  fi

  # Build the JSON with node's JSON.stringify (already required for the model
  # catalog extractor above) rather than hand-splicing strings, so escaping of
  # the doubly-nested CODEX_CONFIG-inside-BUZZ_ACP_FAILOVER_ENV JSON is
  # guaranteed correct regardless of what characters end up in these values.
  if [ -z "${BUZZ_ACP_FAILOVER_ENV:-}" ]; then
    BUZZ_ACP_FAILOVER_ENV="$(node -e '
      const provider = {
        name: "Azure Foundry (failover)",
        base_url: process.env.AZURE_FOUNDRY_BASE_URL,
        env_key: "AZURE_FOUNDRY_API_KEY",
        wire_api: "responses",
      };
      if (process.env.AZURE_FOUNDRY_API_VERSION) {
        provider.query_params = { "api-version": process.env.AZURE_FOUNDRY_API_VERSION };
      }
      const codexConfig = {
        model: process.env.AZURE_FOUNDRY_DEPLOYMENT,
        model_provider: "azure-foundry",
        model_providers: { "azure-foundry": provider },
      };
      process.stdout.write(JSON.stringify({
        MODEL_PROVIDER: "azure-foundry",
        CODEX_CONFIG: JSON.stringify(codexConfig),
      }));
    ')"
    export BUZZ_ACP_FAILOVER_ENV
  fi

  echo "provider failover: azure-foundry/${AZURE_FOUNDRY_DEPLOYMENT} enabled" >&2
}

# Test hook: exercise configure_provider_failover() against a throwaway HOME
# without starting an agent, touching identity state, or requiring root.
# Prints the resulting BUZZ_ACP_FAILOVER_ENV (or nothing, if failover stayed
# disabled) to stdout so tests can assert on it — the export itself does not
# survive this process exiting.
if [ "${BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY:-false}" = "true" ]; then
  configure_provider_failover
  printf '%s\n' "${BUZZ_ACP_FAILOVER_ENV:-}"
  exit 0
fi

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

codex_auth_source=/run/secrets/varvik-codex-auth.json
# Codex consumes OPENAI_API_KEY. Keep CODEX_API_KEY as the documented
# deployment-facing alias, without changing the precedence of an explicit
# OPENAI_API_KEY when both are set.
normalize_codex_api_key

# An organization API key is authoritative for unattended agents. Never let a
# copied personal subscription session in the durable Codex state volume take
# precedence over that non-interactive credential.
if [ -n "${OPENAI_API_KEY:-}" ]; then
  use_openai_api_key=true
else
  use_openai_api_key=false
fi

# Subscription credentials rotate independently of persistent agent state. A
# mounted source is authoritative only when the process is not using the API
# path; stale volume copies must not shadow either credential mode.
if [ "${use_openai_api_key}" = false ] && [ -e "${codex_auth_source}" ] &&
  { [ ! -f "${codex_auth_source}" ] || [ ! -s "${codex_auth_source}" ]; }; then
  echo "Mounted Codex authentication must be a non-empty file" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  /usr/local/bin/agent-runtime-init >/dev/null
  prepare_codex_auth /home/node /home/buzz-manual "${codex_auth_source}"
  export HOME=/var/lib/buzz-harness
  cd /var/lib/buzz-harness
  export BUZZ_CODEX_AUTH_PREPARED=true
  # Only the supervisor can switch worker identities and stop their groups.
  # Ordinary and manual ACP/helper children must strip these capabilities.
  exec setpriv --reuid=1001 --regid=1001 --clear-groups \
    --inh-caps=-all,+setuid,+setgid,+kill \
    --ambient-caps=-all,+setuid,+setgid,+kill --no-new-privs "$0" "$@"
fi
[ "$(id -u)" -eq 1001 ] && [ "${BUZZ_CODEX_AUTH_PREPARED:-false}" = true ] || {
  echo 'Hosted agent must start through the isolated root initializer' >&2
  exit 1
}
unset BUZZ_CODEX_AUTH_PREPARED
export HOME=/var/lib/buzz-harness
export BUZZ_AGENT_KEY_FILE=/var/lib/buzz-harness/identity.env
export BUZZ_ACP_SUPERVISOR_PROFILE=linux-uids-v1
export BUZZ_ACP_WORKFLOW_STATE_DIR=/var/lib/buzz-harness/workflow-runs
export BUZZ_ACP_ORDINARY_HOME=/home/node
export BUZZ_ACP_MANUAL_HOME=/home/buzz-manual
export BUZZ_ACP_MANUAL_WORKSPACE=/home/buzz-manual/workspace
export BUZZ_ACP_BROKER_GID=1003

configure_provider_failover

# Root migrated/generated this exact identity before dropping privileges.
VARVIK_AGENT_PUBKEY="$(sed -n 's/^VARVIK_AGENT_PUBKEY=\([0-9a-f]\{64\}\)$/\1/p' "${BUZZ_AGENT_KEY_FILE}")"
BUZZ_PRIVATE_KEY="$(sed -n 's/^BUZZ_PRIVATE_KEY=\([0-9a-f]\{64\}\)$/\1/p' "${BUZZ_AGENT_KEY_FILE}")"
printf '%s' "${VARVIK_AGENT_PUBKEY}" | grep -Eq '^[0-9a-f]{64}$' || exit 1
printf '%s' "${BUZZ_PRIVATE_KEY}" | grep -Eq '^[0-9a-f]{64}$' || exit 1
export VARVIK_AGENT_PUBKEY BUZZ_PRIVATE_KEY

# Ask the configured ACP adapter for its single canonical model catalog before
# publishing the hosted directory entry. Exact stable/unstable ACP aliases are
# controller-private bindings and must never leak into the public profile.
if [ -z "${BUZZ_ACP_PROFILE_MODELS_JSON:-}" ] ||
  [ -z "${BUZZ_ACP_PROFILE_MODEL_FAMILIES_JSON:-}" ] ||
  [ -z "${BUZZ_ACP_PROFILE_CATALOG_DIGEST:-}" ]; then
  raw_models="$(buzz-acp models --json 2>/dev/null || true)"
  if [ -z "${BUZZ_ACP_PROFILE_MODELS_JSON:-}" ]; then
    BUZZ_ACP_PROFILE_MODELS_JSON="$(printf '%s' "${raw_models}" | extract_profile_model_catalog models)"
  fi
  if [ -z "${BUZZ_ACP_PROFILE_MODEL_FAMILIES_JSON:-}" ]; then
    BUZZ_ACP_PROFILE_MODEL_FAMILIES_JSON="$(printf '%s' "${raw_models}" | extract_profile_model_catalog model_families)"
  fi
  if [ -z "${BUZZ_ACP_PROFILE_CATALOG_DIGEST:-}" ]; then
    BUZZ_ACP_PROFILE_CATALOG_DIGEST="$(printf '%s' "${raw_models}" | extract_profile_model_catalog catalog_digest | tr -d '"')"
  fi
fi
export BUZZ_ACP_PROFILE_MODELS_JSON BUZZ_ACP_PROFILE_MODEL_FAMILIES_JSON BUZZ_ACP_PROFILE_CATALOG_DIGEST

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

  # Managed deployments reconcile the private channel owner before agents are
  # started. Do not make the agent repeat that privileged write: a bot can read
  # its assigned private channel but cannot grant the owner role there.
  if [ "${BUZZ_ACP_SKIP_PRIVATE_OWNER_BOOTSTRAP:-false}" != "true" ]; then
    buzz channels add-member \
      --channel "${private_channel_id}" \
      --pubkey "${BUZZ_ACP_PROFILE_OWNER_PUBKEY}" \
      --role owner
  fi

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
    --resources "${BUZZ_ACP_PROFILE_RESOURCES:-}" \
    --audience "${BUZZ_ACP_PROFILE_AUDIENCE}" \
    --access-tier "${BUZZ_ACP_PROFILE_ACCESS_TIER}" \
    --channel-add-policy "${BUZZ_ACP_CHANNEL_ADD_POLICY}" \
    --owner-pubkey "${BUZZ_ACP_PROFILE_OWNER_PUBKEY}"
else
  set -- buzz agents publish-profile \
    --display-name "${BUZZ_ACP_DISPLAY_NAME}" \
    --about "${BUZZ_ACP_PROFILE_ABOUT}" \
    --resources "${BUZZ_ACP_PROFILE_RESOURCES:-}" \
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
set -- "$@" --model-families-json "${BUZZ_ACP_PROFILE_MODEL_FAMILIES_JSON:-[]}"
if [ -n "${BUZZ_ACP_PROFILE_CATALOG_DIGEST:-}" ] && [ "${BUZZ_ACP_PROFILE_CATALOG_DIGEST}" != "null" ]; then
  set -- "$@" --catalog-digest "${BUZZ_ACP_PROFILE_CATALOG_DIGEST}"
fi
if [ -n "${BUZZ_ACP_MODEL:-}" ]; then
  set -- "$@" --model "${BUZZ_ACP_MODEL}"
fi

"$@"

exec buzz-acp

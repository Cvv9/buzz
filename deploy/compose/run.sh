#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

COMPOSE_FILES=(-f compose.yml)
if [[ "${BUZZ_COMPOSE_TLS:-false}" == "true" ]]; then
  COMPOSE_FILES+=(-f compose.caddy.yml)
fi
if [[ "${BUZZ_COMPOSE_DEV:-false}" == "true" ]]; then
  COMPOSE_FILES+=(-f compose.dev.yml)
fi

compose() {
  docker compose --env-file .env "${COMPOSE_FILES[@]}" "$@"
}

AGENT_SERVICES=(
  agent-project-brain
  agent-market-intelligence
  agent-opportunity-scout
  agent-bid-partnerships
  agent-gtm-discovery
  agent-people-culture
  agent-chief-of-staff
  agent-operations-desk
)
PERSONAL_AGENT_SERVICES=(
  agent-personal-varun
  agent-personal-vikram
  agent-personal-adhika
  agent-personal-swathi
  agent-personal-raja
)

require_env() {
  if [[ ! -f .env ]]; then
    cat >&2 <<'MSG'
Missing deploy/compose/.env.

Copy .env.example to .env and replace every CHANGE_ME value, or run the bootstrap
script once it lands. Do not start production with generated secrets missing.
MSG
    exit 1
  fi
  if grep -Eq '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=.*CHANGE_ME' .env; then
    cat >&2 <<'MSG'
deploy/compose/.env still contains CHANGE_ME placeholders.
Generate stable secrets first; these values must not rotate on restart.
MSG
    exit 1
  fi
}

env_has_value() {
  [ -n "$(printenv "${1}" 2>/dev/null || true)" ] || grep -Eq "^${1}=.+" .env
}

require_agent_credentials() {
  if ! env_has_value CODEX_API_KEY && ! env_has_value OPENAI_API_KEY; then
    echo "Set CODEX_API_KEY or OPENAI_API_KEY in .env, or use the ChatGPT command." >&2
    exit 1
  fi
}

require_runtime_controller() {
  for key in BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON; do
    if ! env_has_value "${key}"; then
      echo "Set ${key} in deploy/compose/.env before starting managed agents." >&2
      exit 1
    fi
  done
}

verify_running_services() {
  local running service
  running="$(compose ps --status running --services)"
  for service in "$@"; do
    if ! grep -Fxq "${service}" <<<"${running}"; then
      echo "Service ${service} is not running after deployment." >&2
      return 1
    fi
  done
}

require_personal_pubkeys() {
  local missing=()
  for key in VIKRAM_PUBKEY ADHIKA_PUBKEY SWATHI_PUBKEY RAJA_PUBKEY; do
    if ! env_has_value "${key}"; then
      missing+=("${key}")
    fi
  done
  if ! env_has_value VARUN_PUBKEY && ! env_has_value RELAY_OWNER_PUBKEY; then
    missing+=("VARUN_PUBKEY (or RELAY_OWNER_PUBKEY)")
  fi
  if (( ${#missing[@]} > 0 )); then
    printf 'Set these team pubkeys in deploy/compose/.env first: %s\n' "${missing[*]}" >&2
    exit 1
  fi
}

backup_hint() {
  cat <<'MSG'
Back up these before upgrades and on a regular schedule:

- deploy/compose/.env, especially BUZZ_RELAY_PRIVATE_KEY, DB/Redis/S3 secrets, and BUZZ_GIT_HOOK_HMAC_SECRET
- The owner private key if bootstrap generated one for RELAY_OWNER_PUBKEY
- Postgres data (prefer pg_dump or a quiesced volume snapshot)
- MinIO/S3 bucket contents for media and git objects
- buzz-git-data volume (BUZZ_GIT_REPO_PATH=/data/git)
- Caddy data/config volumes if using compose.caddy.yml
- buzz-agent-codex-data if using ChatGPT subscription authentication

Keep Postgres + object/git state snapshots from the same maintenance window.
MSG
}

case "${1:-help}" in
  start|up)
    require_env
    compose up -d --wait
    ;;
  start-agents)
    require_env
    require_agent_credentials
    require_runtime_controller
    compose --profile agents up -d --wait
    verify_running_services runtime-controller "${AGENT_SERVICES[@]}"
    ;;
  start-agents-chatgpt)
    require_env
    if ! env_has_value VARVIK_CODEX_AUTH_FILE; then
      echo "Set VARVIK_CODEX_AUTH_FILE in .env first." >&2
      exit 1
    fi
    require_runtime_controller
    compose -f compose.agent-chatgpt.yml --profile agents up -d --wait
    verify_running_services runtime-controller "${AGENT_SERVICES[@]}"
    ;;
  start-personal-agents)
    require_env
    require_personal_pubkeys
    require_agent_credentials
    require_runtime_controller
    compose --profile personal-agents up -d --wait
    verify_running_services runtime-controller "${PERSONAL_AGENT_SERVICES[@]}"
    ;;
  start-personal-agents-chatgpt)
    require_env
    require_personal_pubkeys
    if ! env_has_value VARVIK_CODEX_AUTH_FILE; then
      echo "Set VARVIK_CODEX_AUTH_FILE in .env first." >&2
      exit 1
    fi
    require_runtime_controller
    compose -f compose.agent-chatgpt.yml --profile personal-agents up -d --wait
    verify_running_services runtime-controller "${PERSONAL_AGENT_SERVICES[@]}"
    ;;
  stop|down)
    compose down
    ;;
  restart)
    require_env
    compose up -d --wait --force-recreate relay
    ;;
  pull)
    require_env
    compose pull
    ;;
  upgrade)
    require_env
    compose pull
    compose up -d --wait
    backup_hint
    ;;
  upgrade-runtime)
    require_env
    require_agent_credentials
    require_runtime_controller
    compose pull relay runtime-controller
    compose up -d --wait relay
    compose --profile agents up -d --wait runtime-controller
    compose --profile agents up -d --wait agent-market-intelligence
    verify_running_services runtime-controller agent-market-intelligence
    if [[ "${BUZZ_RUNTIME_CANARY_APPROVED:-false}" != "true" ]]; then
      echo "Runtime canary is healthy. Complete the runtime acceptance check, then rerun with BUZZ_RUNTIME_CANARY_APPROVED=true to roll the fleet." >&2
      exit 2
    fi
    compose --profile agents up -d --wait
    verify_running_services runtime-controller "${AGENT_SERVICES[@]}"
    ;;
  logs)
    shift || true
    compose logs -f "${@:-relay}"
    ;;
  status|ps)
    compose ps
    ;;
  config)
    require_env
    compose config
    ;;
  backup-hint)
    backup_hint
    ;;
  add-member)
    docker compose exec relay /usr/local/bin/buzz-admin add-member --pubkey "${2:?Usage: ./run.sh add-member <npub-or-hex> [--role member|admin]}" "${@:3}"
    ;;
  remove-member)
    docker compose exec relay /usr/local/bin/buzz-admin remove-member --pubkey "${2:?Usage: ./run.sh remove-member <npub-or-hex> [--role member|admin]}" "${@:3}"
    ;;
  list-members)
    docker compose exec relay /usr/local/bin/buzz-admin list-members
    ;;
  help|-h|--help)
    cat <<'MSG'
Usage: ./run.sh <command>

Commands:
  start                  Start Buzz with docker compose up -d --wait
  start-agents           Start Buzz plus Codex using an API key
  start-agents-chatgpt   Start Buzz plus Codex using an existing auth.json
  start-personal-agents  Start the five private Companions using an API key
  start-personal-agents-chatgpt
                          Start the five private Companions using auth.json
  stop          Stop containers without deleting volumes
  restart       Recreate the relay after env/image changes
  pull          Pull configured images
  upgrade       Pull and restart, then print backup reminders
  upgrade-runtime
                Deploy relay/controller compatibility, then one canary; set
                BUZZ_RUNTIME_CANARY_APPROVED=true only after acceptance to roll the fleet
  logs [svc]    Follow logs (default: relay)
  status        Show compose service status
  config        Render merged compose config
  backup-hint   Print the production backup checklist

  add-member <npub-or-hex> [--role member|admin]
                Add a relay member (default role: member)
  remove-member <npub-or-hex> [--role member|admin]
                Remove a relay member
  list-members  List all relay members

  Note: when adding multiple members in a loop, add `sleep 1` between
  invocations to avoid same-second timestamp collisions in the kind:13534
  roster event. Do not use parallel adds (e.g. xargs -P).

Environment switches:
  BUZZ_COMPOSE_TLS=true   Include compose.caddy.yml for automatic HTTPS
  BUZZ_COMPOSE_DEV=true   Include compose.dev.yml for local admin ports/tools
MSG
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run ./run.sh help" >&2
    exit 1
    ;;
esac

#!/usr/bin/env bats

setup() {
  repo_root="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"
  entrypoint="${repo_root}/deploy/compose/agent-entrypoint.sh"
  # A path that does not exist and is never created. Production mounts
  # ~/.codex/config.toml read-only from the host on a read-only container
  # filesystem, so configure_provider_failover() must never touch $HOME at
  # all — using a nonexistent HOME (instead of a real mktemp -d) proves that.
  test_home="$(mktemp -u)/does-not-exist"
}

@test "provider failover exports BUZZ_ACP_FAILOVER_ENV with a nested azure-foundry model_providers entry" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    AZURE_FOUNDRY_API_KEY=secret \
    AZURE_FOUNDRY_BASE_URL=https://resource.openai.azure.com/openai/v1 \
    AZURE_FOUNDRY_DEPLOYMENT=hermes-gpt-5-5 \
    AZURE_FOUNDRY_API_VERSION=2025-04-01-preview \
    sh "${entrypoint}"

  [ "${status}" -eq 0 ]
  [ ! -e "${test_home}" ]
  # codex-acp always spawns `codex app-server` bare and never accepts CLI
  # config flags — the switch must go through env vars, not `-c` args.
  [[ "${output}" != *'"-c"'* ]]
  json_line="${lines[${#lines[@]}-1]}"
  node -e '
    const line = process.argv[1].trim();
    const outer = JSON.parse(line);
    if (outer.MODEL_PROVIDER !== "azure-foundry") process.exit(1);
    const codexConfig = JSON.parse(outer.CODEX_CONFIG);
    if (codexConfig.model !== "hermes-gpt-5-5") process.exit(2);
    if (codexConfig.model_provider !== "azure-foundry") process.exit(3);
    const provider = codexConfig.model_providers?.["azure-foundry"];
    if (!provider) process.exit(4);
    if (provider.base_url !== "https://resource.openai.azure.com/openai/v1") process.exit(5);
    if (provider.env_key !== "AZURE_FOUNDRY_API_KEY") process.exit(6);
    if (provider.wire_api !== "responses") process.exit(7);
    if (provider.query_params?.["api-version"] !== "2025-04-01-preview") process.exit(8);
    if (line.includes("secret")) process.exit(9);
  ' "${json_line}"
}

@test "provider failover omits query_params when AZURE_FOUNDRY_API_VERSION is unset" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    AZURE_FOUNDRY_API_KEY=secret \
    AZURE_FOUNDRY_BASE_URL=https://resource.openai.azure.com/openai/v1 \
    AZURE_FOUNDRY_DEPLOYMENT=hermes-gpt-5-5 \
    sh "${entrypoint}"

  [ "${status}" -eq 0 ]
  [ ! -e "${test_home}" ]
  json_line="${lines[${#lines[@]}-1]}"
  node -e '
    const outer = JSON.parse(process.argv[1].trim());
    const codexConfig = JSON.parse(outer.CODEX_CONFIG);
    const provider = codexConfig.model_providers["azure-foundry"];
    if ("query_params" in provider) process.exit(1);
  ' "${json_line}"
}

@test "provider failover does not override an operator-supplied BUZZ_ACP_FAILOVER_ENV" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    AZURE_FOUNDRY_API_KEY=secret \
    AZURE_FOUNDRY_BASE_URL=https://resource.openai.azure.com/openai/v1 \
    AZURE_FOUNDRY_DEPLOYMENT=hermes-gpt-5-5 \
    BUZZ_ACP_FAILOVER_ENV='{"CUSTOM":"1"}' \
    sh "${entrypoint}"

  [ "${status}" -eq 0 ]
  [ ! -e "${test_home}" ]
  [ "${lines[${#lines[@]}-1]}" = '{"CUSTOM":"1"}' ]
}

@test "provider failover rejects a partial AZURE_FOUNDRY_* configuration" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    AZURE_FOUNDRY_API_KEY=secret \
    sh "${entrypoint}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *"must all be set together"* ]]
  [ ! -e "${test_home}" ]
}

@test "provider failover rejects a non-https base URL" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    AZURE_FOUNDRY_API_KEY=secret \
    AZURE_FOUNDRY_BASE_URL=http://insecure.example.com \
    AZURE_FOUNDRY_DEPLOYMENT=hermes \
    sh "${entrypoint}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *"must start with https://"* ]]
  [ ! -e "${test_home}" ]
}

@test "provider failover rejects a deployment name with commas or quotes" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    AZURE_FOUNDRY_API_KEY=secret \
    AZURE_FOUNDRY_BASE_URL=https://resource.openai.azure.com/openai/v1 \
    AZURE_FOUNDRY_DEPLOYMENT='bad,name"x' \
    sh "${entrypoint}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *"must match"* ]]
  [ ! -e "${test_home}" ]
}

@test "provider failover rejects an invalid AZURE_FOUNDRY_API_VERSION" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    AZURE_FOUNDRY_API_KEY=secret \
    AZURE_FOUNDRY_BASE_URL=https://resource.openai.azure.com/openai/v1 \
    AZURE_FOUNDRY_DEPLOYMENT=hermes \
    AZURE_FOUNDRY_API_VERSION='bad version"' \
    sh "${entrypoint}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *"AZURE_FOUNDRY_API_VERSION must match"* ]]
  [ ! -e "${test_home}" ]
}

@test "provider failover is a no-op when no AZURE_FOUNDRY_* vars are set" {
  run env -i \
    HOME="${test_home}" \
    PATH="${PATH}" \
    BUZZ_AGENT_ENTRYPOINT_FAILOVER_ONLY=true \
    sh "${entrypoint}"

  [ "${status}" -eq 0 ]
  [ ! -e "${test_home}" ]
}

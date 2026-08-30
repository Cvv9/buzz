#!/usr/bin/env bats

@test "entrypoint publishes only canonical model families" {
  repo_root="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"
  fixture="${BATS_TEST_DIRNAME}/fixtures/agent-model-catalog.json"

  run sh -c 'BUZZ_AGENT_ENTRYPOINT_MODELS_ONLY=true sh "$1" < "$2"' _ \
    "${repo_root}/deploy/compose/agent-entrypoint.sh" "${fixture}"

  [ "${status}" -eq 0 ]
  node -e '
    const output = JSON.parse(process.argv[1]);
    if (output.models.length !== 1) process.exit(1);
    if (output.model_families.length !== 1) process.exit(2);
    if (output.models[0].id !== "gpt-3.5-turbo-16k") process.exit(3);
    if (JSON.stringify(output).includes("bindings")) process.exit(4);
    if (JSON.stringify(output).includes("legacy-gpt35")) process.exit(5);
  ' "${output}"
}

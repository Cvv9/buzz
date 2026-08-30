#!/usr/bin/env bats

setup() {
  repo_root="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"
  compose_file="${repo_root}/deploy/compose/compose.yml"
}

@test "compose pins one controller across relay runners and an isolated controller service" {
  run node -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    for (const required of [
      /^  runtime-controller:/m,
      /BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY:/,
      /BUZZ_ACP_RUNTIME_CONTROLLER_PUBKEY:/,
      /BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY:/,
      /buzz-runtime-controller-state:\/var\/lib\/buzz-runtime-controller/,
      /restart: unless-stopped/,
      /read_only: true/,
      /healthcheck:/,
    ]) if (!required.test(text)) process.exit(10);
    const controller = text.match(/^  runtime-controller:\n([\s\S]*?)(?=^  [a-z0-9-]+:|^volumes:)/m)?.[1] ?? "";
    if (!controller.includes("BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY:")) process.exit(11);
    if (controller.includes("env_file:")) process.exit(15);
    if (text.includes("/var/run/docker.sock")) process.exit(12);
    const agentAnchor = text.match(/^x-varvik-agent-environment:[\s\S]*?(?=^x-varvik-agent-service:)/m)?.[0] ?? "";
    if (agentAnchor.includes("BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY")) process.exit(13);
    if (agentAnchor.includes("BUZZ_RELAY_PRIVATE_KEY")) process.exit(14);
    const agentService = text.match(/^x-varvik-agent-service:[\s\S]*?(?=^services:)/m)?.[0] ?? "";
    if (agentService.includes("env_file:")) process.exit(16);
  ' "${compose_file}"

  [ "${status}" -eq 0 ]
}

@test "controller entrypoint emits a root-only strict config without logging secrets" {
  script="${repo_root}/deploy/compose/runtime-controller-entrypoint.sh"
  run sh -n "${script}"
  [ "${status}" -eq 0 ]
  run grep -E 'umask 077|BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON|BUZZ_RUNTIME_CONTROLLER_CONFIG' "${script}"
  [ "${status}" -eq 0 ]
  run grep -E 'set -x|echo.*PRIVATE_KEY|printf.*PRIVATE_KEY' "${script}"
  [ "${status}" -ne 0 ]
}

@test "runtime rollout is relay then controller then canary then fleet" {
  run node -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const block = text.match(/upgrade-runtime\)([\s\S]*?);;/)?.[1] ?? "";
    const order = [
      "relay",
      "runtime-controller",
      "agent-market-intelligence",
      "compose --profile agents up -d --wait\n"
    ].map(token => block.indexOf(token));
    if (order.some(index => index < 0)) process.exit(20);
    if (!(order[0] < order[1] && order[1] < order[2] && order[2] < order[3])) process.exit(21);
  ' "${repo_root}/deploy/compose/run.sh"
  [ "${status}" -eq 0 ]
}

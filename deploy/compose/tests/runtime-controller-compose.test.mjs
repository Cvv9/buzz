import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, "../../..");
const compose = readFileSync(resolve(root, "deploy/compose/compose.yml"), "utf8");
const runScript = readFileSync(resolve(root, "deploy/compose/run.sh"), "utf8");
const entrypoint = readFileSync(
  resolve(root, "deploy/compose/runtime-controller-entrypoint.sh"),
  "utf8",
);

test("relay runners and controller use one public pin with isolated secrets", () => {
  for (const required of [
    /^  runtime-controller:/m,
    /BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY:/,
    /BUZZ_ACP_RUNTIME_CONTROLLER_PUBKEY:/,
    /BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY:/,
    /buzz-runtime-controller-state:\/var\/lib\/buzz-runtime-controller/,
    /restart: unless-stopped/,
    /read_only: true/,
    /healthcheck:/,
  ]) {
    assert.match(compose, required);
  }
  const controller =
    compose.match(
      /^  runtime-controller:\n([\s\S]*?)(?=^  [a-z0-9-]+:|^volumes:)/m,
    )?.[1] ?? "";
  assert.match(controller, /BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY:/);
  assert.doesNotMatch(controller, /env_file:/);
  assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/);
  const agentAnchor =
    compose.match(
      /^x-varvik-agent-environment:[\s\S]*?(?=^x-varvik-agent-service:)/m,
    )?.[0] ?? "";
  assert.doesNotMatch(agentAnchor, /BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY/);
  assert.doesNotMatch(agentAnchor, /BUZZ_RELAY_PRIVATE_KEY/);
  const agentServiceAnchor =
    compose.match(/^x-varvik-agent-service:[\s\S]*?(?=^services:)/m)?.[0] ?? "";
  assert.doesNotMatch(agentServiceAnchor, /env_file:/);
});

test("controller entrypoint creates a strict root-only config without debug leaks", () => {
  assert.match(entrypoint, /umask 077/);
  assert.match(entrypoint, /chmod 700/);
  assert.match(entrypoint, /chmod 600/);
  assert.match(entrypoint, /BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON/);
  assert.match(entrypoint, /BUZZ_RUNTIME_CONTROLLER_CONFIG/);
  assert.doesNotMatch(entrypoint, /set -x/);
  assert.doesNotMatch(entrypoint, /echo[^\n]*PRIVATE_KEY/);
});

test("runtime rollout orders relay controller canary and fleet", () => {
  const block = runScript.match(/upgrade-runtime\)([\s\S]*?);;/)?.[1] ?? "";
  const order = [
    "compose up -d --wait relay",
    "compose --profile agents up -d --wait runtime-controller",
    "compose --profile agents up -d --wait agent-market-intelligence",
    "compose --profile agents up -d --wait\n",
  ].map((token) => block.indexOf(token));
  assert.ok(order.every((index) => index >= 0), `missing rollout step: ${order}`);
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3]);
});

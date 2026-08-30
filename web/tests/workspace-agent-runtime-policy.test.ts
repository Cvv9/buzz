import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkspaceAgentModelFamilies,
  parseWorkspaceAgentModels,
} from "../src/features/workspace/workspace-agent-models.ts";
import {
  buildHostedAgentRuntimeRequestTemplate,
  latestTrustedRuntimeStatus,
  parseAgentRuntimeAcknowledgement,
  parseHostedAgentRuntimeDiscovery,
  projectWorkspaceAgentRuntime,
} from "../src/features/workspace/workspace-agent-runtime.ts";

const AGENT = "a".repeat(64);
const CONTROLLER = "b".repeat(64);
const DIGEST = "c".repeat(64);
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";

const families = [
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6-Sol",
    description: "Frontier model",
    default_effort: "medium",
    efforts: ["ultra", "low", "medium", "high", "xhigh", "max", "low"],
  },
  {
    id: "gpt-3.5-turbo-16k",
    name: "GPT-3.5-Turbo-16k",
    description: "Legacy model",
    default_effort: "medium",
    efforts: ["medium"],
  },
  {
    id: "gpt-3.5-turbo-16k",
    name: "GPT-3.5-Turbo-16k",
    description: "Legacy model",
    default_effort: "medium",
    efforts: ["medium"],
  },
];

function acknowledgement(overrides: Record<string, unknown> = {}) {
  return {
    schema: "buzz.agent-runtime.v1",
    controller_pubkey: CONTROLLER,
    revision: 4,
    model: "gpt-5.6-sol",
    effort: "high",
    effective_name: "Market Intelligence",
    catalog_digest: DIGEST,
    ...overrides,
  };
}

function statusEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "1".repeat(64),
    kind: 30181,
    pubkey: CONTROLLER,
    created_at: 100,
    tags: [["d", AGENT]],
    content: JSON.stringify({
      schema: "buzz.hosted-agent-runtime-status.v1",
      agent_pubkey: AGENT,
      request_id: REQUEST_ID,
      revision: 5,
      state: "pending_busy",
      effective: {
        model: "gpt-5.6-sol",
        effort: "high",
        runtime_name: "Market Intelligence",
      },
      requested: {
        model: "gpt-5.6-terra",
        effort: "medium",
        runtime_name: "Market Intelligence",
      },
      catalog_digest: DIGEST,
      error: null,
      ...overrides,
    }),
  };
}

test("normalized public model families are unique and keep supported efforts separate", () => {
  assert.deepEqual(parseWorkspaceAgentModelFamilies(families), [
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6-Sol",
      description: "Frontier model",
      defaultEffort: "medium",
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      id: "gpt-3.5-turbo-16k",
      name: "GPT-3.5-Turbo-16k",
      description: "Legacy model",
      defaultEffort: "medium",
      efforts: ["medium"],
    },
  ]);
  assert.equal(
    parseWorkspaceAgentModelFamilies([
      ...families,
      {
        ...families[0],
        id: "gpt-5.6-sol",
        description: "conflicting signed metadata",
      },
    ]),
    undefined,
  );
  assert.equal(
    parseWorkspaceAgentModelFamilies([
      {
        id: "default",
        name: "Runtime default",
        description: "",
        default_effort: "medium",
        efforts: ["medium"],
      },
    ]),
    undefined,
  );
});

test("flat compatibility catalogs collapse identical model ids without inventing effort rows", () => {
  assert.deepEqual(
    parseWorkspaceAgentModels([
      { id: "gpt-3.5-turbo-16k", name: "GPT-3.5-Turbo-16k" },
      { id: "gpt-3.5-turbo-16k", name: "GPT-3.5-Turbo-16k" },
    ]),
    [{ id: "gpt-3.5-turbo-16k", name: "GPT-3.5-Turbo-16k" }],
  );
});

test("runtime discovery trusts only the exact NIP-11 controller contract", () => {
  assert.deepEqual(
    parseHostedAgentRuntimeDiscovery({
      name: "Buzz",
      buzz_hosted_agent_runtime: {
        version: 1,
        controller_pubkey: CONTROLLER,
        request_kind: 24201,
        status_kind: 30181,
      },
    }),
    {
      version: 1,
      controllerPubkey: CONTROLLER,
      requestKind: 24201,
      statusKind: 30181,
    },
  );
  assert.equal(
    parseHostedAgentRuntimeDiscovery({
      buzz_hosted_agent_runtime: {
        version: 1,
        controller_pubkey: CONTROLLER,
        request_kind: 24201,
        status_kind: 30181,
        injected: true,
      },
    }),
    null,
  );
});

test("agent acknowledgement is strict and bound to the discovered controller", () => {
  assert.deepEqual(
    parseAgentRuntimeAcknowledgement(acknowledgement(), CONTROLLER),
    {
      controllerPubkey: CONTROLLER,
      revision: 4,
      model: "gpt-5.6-sol",
      effort: "high",
      effectiveName: "Market Intelligence",
      catalogDigest: DIGEST,
    },
  );
  assert.equal(
    parseAgentRuntimeAcknowledgement(acknowledgement(), "d".repeat(64)),
    null,
  );
  assert.equal(
    parseAgentRuntimeAcknowledgement(
      acknowledgement({ unexpected: true }),
      CONTROLLER,
    ),
    null,
  );
});

test("only strict newest controller-authored status projects pending runtime truth", () => {
  const older = statusEvent();
  const newest = {
    ...statusEvent({ state: "applying" }),
    id: "0".repeat(64),
  };
  const forged = { ...statusEvent(), pubkey: "d".repeat(64), created_at: 200 };
  const malformed = statusEvent({ secret_service: "agent-market" });
  const selected = latestTrustedRuntimeStatus(
    [older, newest, forged, malformed],
    AGENT,
    CONTROLLER,
  );
  assert.equal(selected?.state, "applying");

  assert.deepEqual(
    projectWorkspaceAgentRuntime(
      parseAgentRuntimeAcknowledgement(acknowledgement(), CONTROLLER),
      selected,
    ),
    {
      effective: {
        model: "gpt-5.6-sol",
        effort: "high",
        runtimeName: "Market Intelligence",
      },
      pending: {
        model: "gpt-5.6-terra",
        effort: "medium",
        runtimeName: "Market Intelligence",
      },
      revision: 5,
      state: "applying",
      error: null,
    },
  );
});

test("runtime request encrypts to the controller and emits only the ephemeral request kind", async () => {
  let recipient = "";
  let plaintext = "";
  const template = await buildHostedAgentRuntimeRequestTemplate(
    {
      controllerPubkey: CONTROLLER,
      agentPubkey: AGENT,
      requestId: REQUEST_ID,
      model: "gpt-5.6-terra",
      effort: "high",
      presentationEventId: null,
      catalogDigest: DIGEST,
      nowSeconds: 1_000,
    },
    async (nextRecipient, nextPlaintext) => {
      recipient = nextRecipient;
      plaintext = nextPlaintext;
      return "opaque-nip44-ciphertext";
    },
  );

  assert.equal(recipient, CONTROLLER);
  assert.deepEqual(JSON.parse(plaintext), {
    schema: "buzz.hosted-agent-runtime-request.v1",
    request_id: REQUEST_ID,
    agent_pubkey: AGENT,
    model: "gpt-5.6-terra",
    effort: "high",
    presentation_event_id: null,
    catalog_digest: DIGEST,
  });
  assert.deepEqual(template, {
    kind: 24201,
    content: "opaque-nip44-ciphertext",
    tags: [
      ["p", CONTROLLER],
      ["agent", AGENT],
      ["request", REQUEST_ID],
      ["expiration", "1300"],
    ],
  });
});

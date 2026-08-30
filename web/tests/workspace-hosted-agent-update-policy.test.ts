import assert from "node:assert/strict";
import test from "node:test";
import {
  executeHostedAgentUpdatePlan,
  planHostedAgentUpdate,
} from "../src/features/workspace/workspace-hosted-agent-update-policy.ts";

const AGENT = "a".repeat(64);
const CONTROLLER = "b".repeat(64);
const DIGEST = "c".repeat(64);

const managedAgent = {
  pubkey: AGENT,
  name: "Market Intelligence",
  picture: "https://example.test/market.png",
  legacyHostedConfigModel: "gpt-3.5-turbo-16k",
  modelFamilies: [
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6-Sol",
      description: "Frontier model",
      defaultEffort: "medium" as const,
      efforts: ["low", "medium", "high", "xhigh", "max"] as const,
    },
    {
      id: "gpt-5.6-terra",
      name: "GPT-5.6-Terra",
      description: "Balanced model",
      defaultEffort: "medium" as const,
      efforts: ["low", "medium", "high", "xhigh"] as const,
    },
  ],
  runtime: {
    effective: {
      model: "gpt-5.6-sol",
      effort: "high" as const,
      runtimeName: "Market Intelligence",
    },
    pending: null,
    revision: 4,
    state: "current" as const,
    error: null,
  },
  runtimeCatalogDigest: DIGEST,
  runtimeControllerPubkey: CONTROLLER,
  runtimeStatusTrusted: true,
};

test("a per-agent model and effort change emits runtime only", () => {
  assert.deepEqual(
    planHostedAgentUpdate(managedAgent, {
      name: "Market Intelligence",
      avatarUrl: "https://example.test/market.png",
      model: "gpt-5.6-terra",
      effort: "xhigh",
    }),
    {
      presentation: null,
      runtime: {
        agentPubkey: AGENT,
        model: "gpt-5.6-terra",
        effort: "xhigh",
        runtimeName: "Market Intelligence",
        catalogDigest: DIGEST,
      },
      runtimeUsesPresentation: false,
    },
  );
});

test("renaming a managed agent preserves legacy presentation data and reconciles runtime", () => {
  assert.deepEqual(
    planHostedAgentUpdate(managedAgent, {
      name: "Opportunity Scout",
      avatarUrl: "https://example.test/market.png",
      model: "gpt-5.6-sol",
      effort: "high",
    }),
    {
      presentation: {
        pubkey: AGENT,
        name: "Opportunity Scout",
        avatarUrl: "https://example.test/market.png",
        model: "gpt-3.5-turbo-16k",
      },
      runtime: {
        agentPubkey: AGENT,
        model: "gpt-5.6-sol",
        effort: "high",
        runtimeName: "Opportunity Scout",
        catalogDigest: DIGEST,
      },
      runtimeUsesPresentation: true,
    },
  );
});

test("avatar-only presentation changes do not restart or reconcile runtime", () => {
  const plan = planHostedAgentUpdate(managedAgent, {
    name: "Market Intelligence",
    avatarUrl: null,
    model: "gpt-5.6-sol",
    effort: "high",
  });
  assert.equal(plan.presentation?.avatarUrl, null);
  assert.equal(plan.runtime, null);
  assert.equal(plan.runtimeUsesPresentation, false);
});

test("legacy presentation updates remain possible without a runtime controller", () => {
  assert.deepEqual(
    planHostedAgentUpdate(
      {
        pubkey: AGENT,
        name: "Legacy agent",
        picture: undefined,
        legacyHostedConfigModel: "gpt-3.5-turbo-16k",
      },
      {
        name: "Renamed legacy agent",
        avatarUrl: null,
        model: null,
        effort: null,
      },
    ),
    {
      presentation: {
        pubkey: AGENT,
        name: "Renamed legacy agent",
        avatarUrl: null,
        model: "gpt-3.5-turbo-16k",
      },
      runtime: null,
      runtimeUsesPresentation: false,
    },
  );
});

test("runtime changes fail closed before any write when status or catalog trust is missing", () => {
  assert.throws(
    () =>
      planHostedAgentUpdate(
        { ...managedAgent, runtimeStatusTrusted: false },
        {
          name: managedAgent.name,
          avatarUrl: managedAgent.picture,
          model: "gpt-5.6-terra",
          effort: "medium",
        },
      ),
    /cannot be verified/i,
  );
  assert.throws(
    () =>
      planHostedAgentUpdate(managedAgent, {
        name: managedAgent.name,
        avatarUrl: managedAgent.picture,
        model: "gpt-5.6-terra",
        effort: "ultra",
      }),
    /not available/i,
  );
});

test("presentation publishes before runtime and its accepted event id binds the reconcile request", async () => {
  const calls: string[] = [];
  const plan = planHostedAgentUpdate(managedAgent, {
    name: "Opportunity Scout",
    avatarUrl: managedAgent.picture,
    model: "gpt-5.6-sol",
    effort: "high",
  });
  await executeHostedAgentUpdatePlan(plan, {
    publishPresentation: async () => {
      calls.push("presentation");
      return { id: "d".repeat(64) };
    },
    publishRuntime: async (input) => {
      calls.push(`runtime:${input.presentationEventId}`);
      return { id: "e".repeat(64) };
    },
  });
  assert.deepEqual(calls, ["presentation", `runtime:${"d".repeat(64)}`]);
});

test("a runtime-only update never publishes presentation", async () => {
  const plan = planHostedAgentUpdate(managedAgent, {
    name: managedAgent.name,
    avatarUrl: managedAgent.picture,
    model: "gpt-5.6-terra",
    effort: "medium",
  });
  let presentationCalls = 0;
  let presentationEventId: string | null | undefined;
  await executeHostedAgentUpdatePlan(plan, {
    publishPresentation: async () => {
      presentationCalls += 1;
      return { id: "d".repeat(64) };
    },
    publishRuntime: async (input) => {
      presentationEventId = input.presentationEventId;
      return { id: "e".repeat(64) };
    },
  });
  assert.equal(presentationCalls, 0);
  assert.equal(presentationEventId, null);
});

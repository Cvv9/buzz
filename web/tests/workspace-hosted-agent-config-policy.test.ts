import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHostedAgentConfigTemplate,
  hostedAgentConfigTarget,
  isNewerReplaceableHead,
} from "../src/features/workspace/workspace-hosted-agent-config-policy.ts";

const AGENT = "a".repeat(64);

test("web hosted-agent writes use the exact public 30180 shape", () => {
  const template = buildHostedAgentConfigTemplate({
    pubkey: AGENT.toUpperCase(),
    name: "  Helpdesk  ",
    avatarUrl: "  https://example.test/a.png  ",
    model: "  gpt-5  ",
  });
  assert.equal(template.kind, 30180);
  assert.deepEqual(template.tags, [["d", AGENT]]);
  assert.deepEqual(JSON.parse(template.content), {
    schema: "buzz.hosted-agent-config.v1",
    agent_pubkey: AGENT,
    name: "Helpdesk",
    avatar_url: "https://example.test/a.png",
    model: "gpt-5",
  });
});

test("web hosted-agent write remains relay-envelope admissible", () => {
  const template = buildHostedAgentConfigTemplate({
    pubkey: AGENT,
    name: "Helpdesk",
    avatarUrl: null,
    model: null,
  });
  const content = JSON.parse(template.content) as Record<string, unknown>;
  assert.deepEqual(Object.keys(content).sort(), [
    "agent_pubkey",
    "avatar_url",
    "model",
    "name",
    "schema",
  ]);
  assert.equal(content.about, undefined);
  assert.deepEqual(template.tags, [["d", AGENT]]);
});

test("only canonical 30180 or namespaced 30177 compatibility configs are read", () => {
  const content = JSON.stringify({
    schema: "buzz.hosted-agent-config.v1",
    agent_pubkey: AGENT,
    name: "Helpdesk",
    avatar_url: null,
    model: null,
  });
  assert.equal(
    hostedAgentConfigTarget({
      id: "a",
      kind: 30180,
      pubkey: "b".repeat(64),
      created_at: 1,
      content,
      tags: [["d", AGENT]],
    }),
    AGENT,
  );
  assert.equal(
    hostedAgentConfigTarget({
      id: "b",
      kind: 30179,
      pubkey: "b".repeat(64),
      created_at: 1,
      content,
      tags: [["d", AGENT]],
    }),
    null,
    "private managed aggregates can never become public hosted configs",
  );
  assert.equal(
    hostedAgentConfigTarget({
      id: "c",
      kind: 30177,
      pubkey: "b".repeat(64),
      created_at: 1,
      content,
      tags: [["d", AGENT]],
    }),
    null,
    "30177 must remain namespaced to avoid reading a managed projection",
  );
});

test("hosted-agent readers reject malformed documents and non-exact d tags", () => {
  const valid = JSON.stringify({
    schema: "buzz.hosted-agent-config.v1",
    agent_pubkey: AGENT,
    name: "Helpdesk",
    avatar_url: null,
    model: null,
  });
  for (const content of [
    "null",
    "[]",
    "{",
    JSON.stringify({ ...JSON.parse(valid), extra: true }),
  ]) {
    assert.equal(
      hostedAgentConfigTarget({
        id: `malformed-${content}`,
        kind: 30180,
        pubkey: "b".repeat(64),
        created_at: 1,
        content,
        tags: [["d", AGENT]],
      }),
      null,
    );
  }
  assert.equal(
    hostedAgentConfigTarget({
      id: "duplicate-d",
      kind: 30180,
      pubkey: "b".repeat(64),
      created_at: 1,
      content: valid,
      tags: [
        ["d", AGENT],
        ["d", AGENT],
      ],
    }),
    null,
  );
  assert.equal(
    hostedAgentConfigTarget({
      id: "extra-tag",
      kind: 30180,
      pubkey: "b".repeat(64),
      created_at: 1,
      content: valid,
      tags: [
        ["d", AGENT],
        ["p", "c".repeat(64)],
      ],
    }),
    null,
  );
});

test("replaceable hosted-config heads use the lowest event id as the equal-time tie-break", () => {
  const lowestId = { id: "a", created_at: 100 };
  const higherId = { id: "b", created_at: 100 };
  assert.equal(isNewerReplaceableHead(lowestId, higherId), true);
  assert.equal(isNewerReplaceableHead(higherId, lowestId), false);
  assert.equal(
    isNewerReplaceableHead({ id: "0", created_at: 101 }, higherId),
    true,
  );
});

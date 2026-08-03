import assert from "node:assert/strict";
import test from "node:test";

import { getHostedAgentPresentation } from "./hostedAgentPresentation.ts";

const agent = {
  pubkey: "a".repeat(64),
  name: "Lanaya",
  avatarUrl: "https://relay.example/lanaya-current.png",
};

test("hosted directory metadata wins over a stale kind:0 profile", () => {
  assert.deepEqual(
    getHostedAgentPresentation(agent, {
      displayName: "Varun Personal Assistant",
      avatarUrl: "https://relay.example/old-assistant.png",
    }),
    {
      displayName: "Lanaya",
      avatarUrl: "https://relay.example/lanaya-current.png",
    },
  );
});

test("hosted presentation falls back to kind:0 only when directory metadata is absent", () => {
  assert.deepEqual(
    getHostedAgentPresentation(
      { ...agent, name: "   ", avatarUrl: null },
      {
        displayName: "Fallback assistant",
        avatarUrl: "https://relay.example/fallback.png",
      },
    ),
    {
      displayName: "Fallback assistant",
      avatarUrl: "https://relay.example/fallback.png",
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  getHostedAgentPresentation,
  overlayHostedAgentProfiles,
} from "./hostedAgentPresentation.ts";

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

test("hosted directory identity overlays stale Inbox profiles by pubkey", () => {
  const pubkey = agent.pubkey.toUpperCase();
  const profiles = {
    [agent.pubkey]: {
      displayName: "Founder Chief of Staff",
      name: "founder-chief-of-staff",
      avatarUrl: "https://relay.example/founder-old.png",
      nip05Handle: "assistant@example.com",
      ownerPubkey: null,
      isAgent: true,
    },
    ["b".repeat(64)]: {
      displayName: "A human",
      avatarUrl: null,
      nip05Handle: null,
      ownerPubkey: null,
    },
  };

  const result = overlayHostedAgentProfiles(profiles, [
    { ...agent, pubkey, ownerPubkey: "c".repeat(64) },
  ]);

  assert.deepEqual(result?.[agent.pubkey], {
    displayName: "Lanaya",
    name: "founder-chief-of-staff",
    avatarUrl: "https://relay.example/lanaya-current.png",
    nip05Handle: "assistant@example.com",
    ownerPubkey: "c".repeat(64),
    isAgent: true,
  });
  assert.equal(result?.["b".repeat(64)], profiles["b".repeat(64)]);
});

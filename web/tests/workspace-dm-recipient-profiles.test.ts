import assert from "node:assert/strict";
import test from "node:test";
import { mergeDmRecipientProfiles } from "../src/features/workspace/dm-recipient-profiles.ts";
import { truncatePubkey } from "../src/shared/lib/pubkey.ts";

const HUMAN = "a".repeat(64);
const AGENT = "b".repeat(64);
const NAMED_AGENT = "c".repeat(64);

test("direct-message picker names hosted agents from the agent directory", () => {
  const profiles = new Map([
    [HUMAN, { pubkey: HUMAN, name: "Vikram" }],
    [AGENT, { pubkey: AGENT, name: truncatePubkey(AGENT) }],
    [NAMED_AGENT, { pubkey: NAMED_AGENT, name: "Already named" }],
  ]);
  const merged = mergeDmRecipientProfiles(profiles, [
    { pubkey: AGENT, name: "Project Brain", isAgent: true },
    { pubkey: NAMED_AGENT, name: "Directory name", isAgent: true },
    { pubkey: "d".repeat(64), name: "Chief of Staff", isAgent: true },
  ]);
  assert.equal(merged.get(HUMAN)?.name, "Vikram");
  assert.equal(merged.get(AGENT)?.name, "Project Brain");
  assert.equal(merged.get(AGENT)?.isAgent, true);
  assert.equal(merged.get(NAMED_AGENT)?.name, "Directory name");
  assert.equal(profiles.get(NAMED_AGENT)?.name, "Already named");
  assert.equal(merged.get("d".repeat(64))?.name, "Chief of Staff");
  assert.equal(mergeDmRecipientProfiles(undefined, undefined).size, 0);
});

test("hosted directory uses kind 0 only when presentation is missing", () => {
  const profiles = new Map([
    [AGENT, { pubkey: AGENT, name: "Fallback name", picture: "fallback.png" }],
  ]);
  const merged = mergeDmRecipientProfiles(profiles, [
    { pubkey: AGENT, name: truncatePubkey(AGENT), isAgent: true },
  ]);
  assert.equal(merged.get(AGENT)?.name, "Fallback name");
  assert.equal(merged.get(AGENT)?.picture, "fallback.png");
  assert.equal(merged.get(AGENT)?.isAgent, true);
  const canonical = mergeDmRecipientProfiles(profiles, [
    {
      pubkey: AGENT,
      name: "Canonical name",
      picture: "canonical.png",
      isAgent: true,
    },
  ]);
  assert.equal(canonical.get(AGENT)?.name, "Canonical name");
  assert.equal(canonical.get(AGENT)?.picture, "canonical.png");
});

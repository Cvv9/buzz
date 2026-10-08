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
  assert.equal(merged.get(NAMED_AGENT)?.name, "Already named");
  assert.equal(merged.get("d".repeat(64))?.name, "Chief of Staff");
  assert.equal(mergeDmRecipientProfiles(undefined, undefined).size, 0);
});

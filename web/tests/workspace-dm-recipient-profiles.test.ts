import assert from "node:assert/strict";
import test from "node:test";
import { mergeDmRecipientProfiles } from "../src/features/workspace/dm-recipient-profiles.ts";
import { truncatePubkey } from "../src/shared/lib/pubkey.ts";
import { activeDirectMessages } from "../src/features/workspace/dm-visibility-policy.ts";
import { isWorkspaceIntegrationProfile } from "../src/features/workspace/workspace-agent-directory-policy.ts";

const HUMAN = "a".repeat(64);
const AGENT = "b".repeat(64);
const NAMED_AGENT = "c".repeat(64);

test("an archived deep-linked conversation never duplicates the active sidebar", () => {
  const archived = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", type: "dm", name: "Vikram, Lina" };
  const other = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", type: "dm", name: "Vikram, Lina" };
  assert.deepEqual(activeDirectMessages([archived, other], new Set([archived.id])), [other]);
  assert.deepEqual(activeDirectMessages([{ ...archived, id: archived.id.toUpperCase() }], new Set([archived.id])), []);
});
test("integration labels are explicit presentation, never inferred from names", () => {
  assert.equal(isWorkspaceIntegrationProfile({ name: "Sylars" }), false);
  assert.equal(isWorkspaceIntegrationProfile({ bot: true, service_type: "integration" }), true);
  assert.equal(isWorkspaceIntegrationProfile({ bot: "true", service_type: "integration" }), false);
});
test("an explicit owner avatar clear cannot resurrect a cached compatibility photo", () => {
  const merged = mergeDmRecipientProfiles(new Map([[AGENT, { pubkey: AGENT, name: "Old", picture: "old.png" }]]), [{ pubkey: AGENT, name: "Oracle", isAgent: true, avatarConfigured: true }]);
  assert.equal(merged.get(AGENT)?.picture, undefined);
});

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

import assert from "node:assert/strict";
import test from "node:test";

import { projectAgentMessage } from "./agentMessageProjection.ts";

test("ordinary agent messages remain unchanged", () => {
  const content = "I checked the build. Two tests failed in the auth crate.";
  assert.deepEqual(projectAgentMessage(content), {
    content,
    rawDetailsHidden: false,
  });
});

test("automation payloads become a readable alert summary", () => {
  const raw = `Actionable alert routed to Sylars Kind: ci-autofix Severity: error Source job: ci-autofix You may diagnose and edit scoped code.
Alert findings: [{"action":"issue","url":"https://github.com/acme/api/issues/92","modelUsage":{"tokens":199}}]
Report: Scanned 36 repo(s), handled 3 new CI failure(s) (mode: issue).
- Issue for acme/api (large) — https://github.com/acme/api/issues/92 Cannot be determined with confidence because the CI payload has no usable diagnostics. ${"x".repeat(800)}
- Deferred acme/portal until the model provider is available: provider 500: {"session_id":"abc","total_cost_usd":1.2}`;
  const projected = projectAgentMessage(raw);

  assert.equal(projected.rawDetailsHidden, true);
  assert.match(projected.content, /Actionable alert routed to Sylars/);
  assert.match(projected.content, /Scanned 36 repositories/);
  assert.match(projected.content, /usable CI diagnostics were unavailable/);
  assert.match(
    projected.content,
    /deferred while the model provider is unavailable/,
  );
  assert.doesNotMatch(
    projected.content,
    /session_id|total_cost_usd|modelUsage/,
  );
});

test("unknown machine payloads keep a human prefix and hide technical data", () => {
  const raw = `Deployment check finished with warnings. You may diagnose the affected service.\n<UNTRUSTED_AUTOMATION_DATA>${'{\\"session_id\\":\\"abc\\"}'.repeat(80)}</UNTRUSTED_AUTOMATION_DATA>`;
  const projected = projectAgentMessage(raw);

  assert.equal(projected.rawDetailsHidden, true);
  assert.match(projected.content, /^Deployment check finished with warnings\./);
  assert.match(projected.content, /Technical payload hidden/);
});

# Buzz Web Exhaustive Regression Audit Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan after the hosted-agent runtime plan, following test-driven development for every code or fixture change.

**Goal:** Give every generated browser route and every top-level web feature a meaningful, machine-enforced scenario, then verify the exact deployed production asset with safe owner-session canaries, scheduled-report evidence, and independently checked cleanup.

**Architecture:** A checked-in route/feature manifest is the coverage source of truth. Fast Node policy tests validate parsers and boundaries; deterministic TypeScript Playwright tests exercise all UI behavior against the in-page relay mock; an isolated relay-backed suite proves signing, authorization, persistence, and multi-client fan-out; a credentialed Python Playwright canary performs only declared read or reversible writes against `buzz.varvikstudios.com`, journaling every mutation before execution and restoring it afterward. CI blocks route/feature drift, while post-deploy audit artifacts identify the exact tested asset.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, Node's test runner, Playwright Test, Python Playwright for production interaction, Axe accessibility checks, Nostr relay mock, isolated Postgres/Redis/relay stack, JSON evidence artifacts, existing PowerShell toolchain wrapper.

**Spec:** `docs/superpowers/specs/2026-08-30-web-regression-audit-design.md`

**Global Constraints:** The audit covers all 28 current generated routes and all 22 current top-level `web/src/features` directories. A route render or screenshot alone is not meaningful coverage. Dynamic routes require valid and missing/unauthorized scenarios. Production writes are restricted to a pre-provisioned audit member, audit channel, and hosted canary; every write is journaled before execution and restored from a recorded baseline. Never delete business data, pair a real device, moderate a real user, rotate a real identity, trigger business workflows, or change business agent settings. Do not upload production credentials, browser storage, traces containing secrets, or unredacted event content. Use native Python Playwright for the production browser interaction. Preserve the user's unrelated desktop edits. Every code task follows an observed red test, minimal change, fresh green test, and signed atomic commit.

---

## Task 1: Define the machine-enforced route and feature coverage contract

**Files:**

- Create: `web/tests/coverage/coverage-contract.ts`
- Create: `web/tests/route-feature-coverage.test.ts`

1. Write failing validator tests using synthetic manifests and temporary route/feature inventories. A missing route, duplicate route, missing feature, nonexistent scenario ID, invalid fixture, invalid production policy, and screenshot-only scenario must each fail with a precise diagnostic.
2. Add a parser test that reads `web/src/app/routeTree.gen.ts` and returns exactly these generated full paths: `/`, `/workflows`, `/workflows/$workflowId`, `/settings`, `/search`, `/repos`, `/repos/$repoId`, `/repos/$repoId/blob/$`, `/repos/$repositoryAddress/work-items`, `/repos/$repositoryAddress/work-items/$workItemId`, `/reminders`, `/pulse`, `/projects`, `/projects/$projectAddress`, `/preferences`, `/pairing`, `/offline`, `/moderation`, `/identity-archive`, `/custom-emoji`, `/channel-state`, `/profiles/$pubkey`, `/messages/new`, `/messages/$channelId`, `/invite/$code`, `/huddles/$channelId`, `/channels/$channelId/posts`, and `/channels/$channelId/posts/$postId`.
3. Add a feature-inventory test that returns exactly `access`, `channel-state`, `custom-emoji`, `forum`, `huddle`, `identity-archive`, `invite`, `media`, `moderation`, `offline`, `pairing`, `preferences`, `presence`, `profiles`, `projects`, `pulse`, `reminders`, `repos`, `search`, `settings`, `workflows`, and `workspace`.
4. Run `./scripts/with-toolchain.ps1 node --experimental-strip-types --test web/tests/route-feature-coverage.test.ts` and observe failure because the validator does not exist.
5. Implement typed parsing and validation in `coverage-contract.ts`. Require unique stable scenario IDs, valid fixture and production-policy enums, at least one behavior assertion per scenario, and a matching `[scenario-id]` token in supplied test titles.
6. Re-run the focused test and commit with `git commit -s -m "test(web): define route coverage contract"`.

## Task 2: Build deterministic, observable relay fixtures

**Files:**

- Modify: `web/tests/e2e/helpers/workspaceRelayMock.ts`
- Create: `web/tests/e2e/helpers/auditFixtures.ts`
- Create: `web/tests/e2e/helpers/auditAssertions.ts`
- Create: `web/tests/e2e/helpers/accessibility.ts`
- Test: `web/tests/e2e/helpers/workspaceRelayMock.test.ts`

1. Add failing helper tests for deterministic owner/admin/member/outsider/controller/agent identities; stream/forum/DM/private channels; project/repository/blob/work-item/workflow/reminder/moderation/offline/pairing fixtures; request logs; subscription counters; disconnect/reconnect; delayed, duplicate, and out-of-order events; explicit first-party HTTP failures; runtime status transitions; and two-context live fan-out.
2. Require fixtures to expose read-only snapshots and reversible mutation helpers. Each helper must fail if cleanup does not return a byte-equivalent normalized baseline.
3. Run the helper test through Node and observe missing fixture APIs.
4. Extend the existing relay mock instead of creating a second incompatible protocol. Keep signing/auth semantics realistic: exact event kinds and tags, replaceable-head ordering, p/h/d gates, NIP-44 envelopes where the client consumes them, and server error text aligned with relay behavior.
5. Add shared assertions for no uncaught page errors, no failed first-party requests unless a scenario injects one, no unexpected WebSocket notices, no duplicate terminal actions, and live propagation within a bounded timeout.
6. Add Axe integration with a small allowlist file that requires rule ID, scope, rationale, owner, and expiry; an empty default allowlist is preferred.
7. Run helper tests and the existing `workspace-identity-and-agents` spec to prove fixture compatibility.
8. Commit with `git commit -s -m "test(web): add observable audit fixtures"`.

## Task 3: Cover access, identity, shell, and navigation routes

**Files:**

- Create: `web/tests/e2e/route-coverage.spec.ts`
- Create: `web/tests/e2e/workspace-access-and-shell.spec.ts`
- Modify: `web/tests/e2e/smoke.spec.ts`
- Modify: `web/tests/e2e/browser-local-devices.smoke.spec.ts`
- Create: `web/tests/coverage/route-feature-manifest.ts`

1. Add failing Playwright scenarios with stable IDs for locked browser identity, generated-key unlock, NIP-07 unlock, sign-out/relock, owner/admin/member/outsider route authorization, and no private data before unlock.
2. Add route-table scenarios that direct-load every static route, navigate through visible links, use browser back/forward, and verify an unknown URL reaches the intended not-found/shell behavior without a blank screen.
3. Add valid plus missing/invalid/unauthorized scenarios for `/invite/$code`, `/profiles/$pubkey`, `/messages/$channelId`, and `/huddles/$channelId`.
4. Assert direct deep links survive reload, current route and selection stay synchronized, owner-only navigation is hidden or denied for non-owner roles, and every tested view has an accessible page title/landmark.
5. Run only these specs and observe the missing scenarios or product defects.
6. Make the smallest product or fixture corrections required. Do not weaken assertions to match broken navigation.
7. Re-run the specs, then the manifest validator. Update only the route/feature entries now backed by passing stable IDs.
8. Commit with `git commit -s -m "test(web): cover access and navigation"`.

## Task 4: Cover workspace communication and collaboration features

**Files:**

- Create: `web/tests/e2e/workspace-channels-and-messages.spec.ts`
- Modify: `web/tests/e2e/workspace-reactions.spec.ts`
- Modify: `web/tests/e2e/workspace-threads.spec.ts`
- Modify: `web/tests/e2e/workspace-media.spec.ts`
- Modify: `web/tests/e2e/workspace-read-state.spec.ts`
- Modify: `web/tests/e2e/workspace-profiles-search.spec.ts`
- Modify: `web/tests/coverage/route-feature-manifest.ts`

1. Add failing scenarios for channel create/rename/description/visibility/archive/unarchive/section changes, membership invite/remove/role changes, deletion safeguards, hidden/read state, unread count, and second-context fan-out.
2. Add message send/edit/delete/reply/thread, mention auto-add policy, DM opening, reactions, attachment upload/download/failure, search, historical author presentation after rename, read markers, dismiss/clear Inbox, and duplicate/out-of-order event handling.
3. Verify permissions at owner/admin/member boundaries and prove agent-specific membership changes use the owner-only policy from the runtime plan while ordinary channel moderation retains its intended admin behavior.
4. Add narrow and wide viewport assertions for composer, sidebar, thread, attachment, and modal controls; add keyboard-only paths for send, menu, and dialog actions.
5. Run the focused specs and observe failures.
6. Fix product defects one at a time with a failing focused test retained for each fix.
7. Re-run focused specs, relevant Node policy tests, and manifest validation. Update corresponding `workspace`, `media`, `search`, `profiles`, and `channel-state` coverage entries.
8. Commit with `git commit -s -m "test(web): cover workspace collaboration"`.

## Task 5: Cover settings, preferences, identity archive, emoji, presence, pulse, and reminders

**Files:**

- Create: `web/tests/e2e/workspace-settings-and-preferences.spec.ts`
- Create: `web/tests/e2e/workspace-safety-and-resilience.spec.ts`
- Modify: `web/tests/e2e/workspace-appearance.spec.ts`
- Modify: `web/tests/e2e/workspace-custom-emoji.spec.ts`
- Modify: `web/tests/e2e/workspace-reminders.spec.ts`
- Modify: `web/tests/coverage/route-feature-manifest.ts`

1. Add failing scenarios for `/settings` and `/preferences`: every visible control changes the correct scoped state, syncs or remains local as designed, survives reload, and does not leak across identities/communities.
2. Cover theme outbox retry and second-context sync, custom emoji create/edit/delete/authorization, presence online/away/offline/expiry, pulse rendering/empty/error, reminders create/reschedule/complete/cancel/due/reload, and identity archive export/import/corrupt archive/wrong identity/confirmation.
3. Cover `/offline` with seeded archive, stale indication, reconnect, and reconciliation. Cover `/pairing` discovery and expiry using only mocked devices and prove no production pairing action is reachable from the test.
4. Inject first-party HTTP failure, WebSocket disconnect, duplicate event, out-of-order replaceable event, timeout, and invalid encrypted payload; assert actionable error, recovery, and no secret text in UI or logs.
5. Run focused specs and observe failures. Fix product defects with retained regressions.
6. Re-run focused specs, relevant unit policy tests, accessibility assertions, and manifest validation. Update `settings`, `preferences`, `identity-archive`, `custom-emoji`, `presence`, `pulse`, `reminders`, `offline`, and `pairing` entries.
7. Commit with `git commit -s -m "test(web): cover settings and resilience"`.

## Task 6: Cover forums, huddles, moderation, and invites

**Files:**

- Create: `web/tests/e2e/workspace-forums-and-moderation.spec.ts`
- Modify: `web/tests/e2e/workspace-huddles.spec.ts`
- Modify: `web/tests/e2e/route-coverage.spec.ts`
- Modify: `web/tests/coverage/route-feature-manifest.ts`

1. Add failing valid/missing/unauthorized scenarios for `/channels/$channelId/posts` and `/channels/$channelId/posts/$postId`; cover create/edit/delete/reply/vote/sort/pagination and live count updates.
2. Cover huddle join/leave/device-denied/reconnect and accessible controls without requiring real microphone capture in deterministic CI.
3. Cover moderation report queue, redacted member view, owner action, permission denial, timeout/ban state, audit display, and cleanup in isolated fixtures.
4. Cover invite creation/consent/invalid/expired/enrollment/duplicate enrollment and safe return route.
5. Run focused specs and observe failures. Implement the smallest corrections.
6. Re-run focused specs and manifest validation; update `forum`, `huddle`, `moderation`, `invite`, and `access` entries.
7. Commit with `git commit -s -m "test(web): cover forums huddles and moderation"`.

## Task 7: Cover projects, repositories, work items, blobs, and workflows

**Files:**

- Create: `web/tests/e2e/workspace-repos-and-work-items.spec.ts`
- Modify: `web/tests/e2e/projects.spec.ts`
- Modify: `web/tests/e2e/workspace-workflows.spec.ts`
- Modify: `web/tests/coverage/route-feature-manifest.ts`

1. Add failing valid/missing/unauthorized scenarios for `/projects/$projectAddress`, `/repos/$repoId`, `/repos/$repoId/blob/$`, `/repos/$repositoryAddress/work-items`, `/repos/$repositoryAddress/work-items/$workItemId`, and `/workflows/$workflowId`.
2. Cover project create/edit/archive/member policy; repository list/detail/default branch/blob path/large or binary blob/missing ref; work-item create/edit/state/link/pagination; and safe download filename/content.
3. Cover workflow create/visual edit/YAML validation/update/enable-disable/manual trigger/run history/approval grant-deny/unauthorized approval/failure/scheduled definition. Assert stable event tags and no duplicate trigger result.
4. Run focused specs and observe failures. Fix product defects with retained regressions.
5. Re-run focused specs, project/workflow/download unit tests, and manifest validation. Update `projects`, `repos`, `workflows`, and download/media scenario entries.
6. Commit with `git commit -s -m "test(web): cover projects repos and workflows"`.

## Task 8: Integrate hosted-agent runtime and name propagation coverage

**Files:**

- Modify: `web/tests/e2e/workspace-hosted-agent-runtime.spec.ts`
- Modify: `web/tests/e2e/workspace-identity-and-agents.spec.ts`
- Modify: `web/tests/coverage/route-feature-manifest.ts`

1. Extend the runtime-plan E2E with audit scenario IDs for separate model/effort controls, exact owner-only mutation, duplicate-label collapse, current/pending/applying/applied/failed state, second-context propagation, reload recovery, and presentation/runtime-name boundary.
2. Add an active-turn fixture: block an agent task, request a new pair, prove zero cancellation and no new claim, release the task, observe exact acknowledgment, then prove the next message and simulated scheduled report use the same revision.
3. Add controller-offline, runner-restart, stale catalog, mismatched acknowledgment, rollback, and retry scenarios.
4. Run focused specs and observe any gaps left by the runtime implementation.
5. Fix gaps without introducing per-task overrides or treating `30180.model` as truth.
6. Re-run the runtime specs and manifest validator; map `workspace` hosted-agent scenarios to the passing IDs.
7. Commit with `git commit -s -m "test(web): audit hosted agent runtime controls"`.

## Task 9: Complete and lock the coverage manifest

**Files:**

- Modify: `web/tests/coverage/route-feature-manifest.ts`
- Modify: `web/tests/route-feature-coverage.test.ts`
- Modify: `web/package.json`
- Modify: `web/playwright.config.ts`

1. Run the manifest validator and inspect every missing, duplicate, phantom, or screenshot-only mapping. Do not suppress failures.
2. Verify all 28 routes and 22 features map to at least one existing passing scenario. Dynamic routes must map to both happy and missing/unauthorized scenario IDs where applicable.
3. Add `test:audit:manifest` and make `check` invoke it explicitly. Register all new deterministic specs in Playwright's smoke project.
4. Run `./scripts/with-toolchain.ps1 pnpm --dir web test:audit:manifest`, `test:unit`, and the full deterministic Playwright suite.
5. Commit with `git commit -s -m "test(web): enforce complete feature coverage"`.

## Task 10: Add an isolated relay-backed web integration project

**Files:**

- Create: `web/playwright.integration.config.ts`
- Create: `web/tests/integration/helpers/relayStack.ts`
- Create: `web/tests/integration/authorization-and-fanout.spec.ts`
- Create: `web/tests/integration/hosted-runtime.spec.ts`
- Create: `web/tests/integration/workflows-and-reports.spec.ts`
- Modify: `web/package.json`
- Modify: `TESTING.md`

1. Add failing integration scenarios that use unique community, owner/admin/member/controller/agent keys and unique fixture prefixes against isolated Postgres, Redis, and relay ports.
2. Prove browser signing, owner-only policy, replaceable storage, live two-client fan-out, reconnect, cross-community isolation, workflow trigger/approval, runtime request/status/ack, and scheduled-report single-terminal behavior.
3. Require teardown to enumerate and remove only fixture-scoped records/containers. Refuse to start when configured host or database resembles production.
4. Run `./scripts/with-toolchain.ps1 pnpm --dir web test:e2e:integration` before implementation and observe the missing script/config fail.
5. Implement stack orchestration using existing repo setup helpers and explicit ports. Do not add test-only bypasses to relay authorization.
6. Run the integration project twice consecutively to prove isolation and cleanup.
7. Document exact prerequisites and commands in `TESTING.md`.
8. Commit with `git commit -s -m "test(web): add relay-backed browser integration"`.

## Task 11: Make scheduled-report health observable and auditable

**Files:**

- Create: `scripts/audit-scheduled-reports.ps1`
- Create: `deploy/compose/scheduled-reports.json`
- Create: `scripts/tests/audit-scheduled-reports.Tests.ps1`
- Modify: `deploy/compose/README.md`
- Modify: `docs/hosted-agent-runtime-control.md`

1. Add failing tests for a strict inventory entry `{agent_pubkey,name,cadence_seconds,initial_delay_seconds,destination_channel,enabled,sla_seconds}` and current observations `{runner_healthy,last_claim_at,last_terminal_at,last_terminal_event_id,next_due_at,runtime_revision}`.
2. Require unique agent/destination/cadence keys, enabled reports to have a recent terminal result inside SLA or an explicit fixed failure, exactly one terminal result per claim, and future `next_due_at`. Silence, missing runner, duplicate terminal result, stale runtime revision, and disabled-but-expected report must fail.
3. Run the PowerShell test and observe missing script/inventory failures.
4. Implement a secret-free inventory for every deployed heartbeat/scheduled report and a read-only auditor that combines Compose health, configured cadence/initial delay, relay event evidence, and kind `10100.runtime` revision. It must emit machine-readable JSON and a concise failing exit code.
5. Add an isolated canary trigger mode that is available only with an explicit canary identity/channel and never targets business schedules. It must prove one claim, one terminal report, and matching runtime revision.
6. Run script unit tests and the read-only local/production inventory mode; do not run canary mode until the dedicated fixtures are verified.
7. Commit with `git commit -s -m "feat(ops): audit scheduled agent reports"`.

## Task 12: Build the safe Python production canary runner

**Files:**

- Create: `scripts/web-production-audit.py`
- Create: `scripts/web-production-audit-policy.json`
- Create: `scripts/tests/test_web_production_audit.py`
- Create: `docs/web-production-audit-runbook.md`
- Modify: `.gitignore`

1. Before using the local browser helper, run `python "$env:USERPROFILE\.agents\skills\webapp-testing\scripts\with_server.py" --help` and record its supported startup contract in the runbook.
2. Write failing Python tests for policy parsing, exact production origin, fixture allowlist, credential presence without logging values, mutation-journal fsync before action, LIFO cleanup, baseline equality, redaction, asset-version capture, WebSocket/HTTP failure collection, and nonzero exit on incomplete cleanup.
3. Add failing dry-run tests that enumerate all manifest routes and proposed actions without launching a browser or mutating state.
4. Implement native asynchronous Python Playwright. Use a persistent browser-state input path supplied at runtime, never committed. Capture the deployed asset hash/version, NIP-11 runtime controller pin, relay/controller/canary health, route results, console errors, first-party request failures, accessibility results, and scenario timings.
5. Permit only the policy's declared actions: read routes/panels; rename/re-avatar/re-model/re-effort/re-access the hosted canary and restore it; mutate the audit member/channel and restore it; trigger the isolated canary schedule. Refuse any target not matching exact pre-provisioned pubkeys/channel IDs.
6. Journal baseline and intended inverse before each write, fsync, perform the write, verify live propagation/reload/second context, then execute and independently verify cleanup. On interruption, rerun cleanup from the journal before any new audit.
7. Ensure output artifacts are secret-free JSON, Markdown, and screenshots of audit-only data. Traces and browser storage remain outside publishable artifacts.
8. Run Python unit tests, dry-run, and a local mock-hosted canary before production.
9. Commit with `git commit -s -m "test(web): add safe production canary runner"`.

## Task 13: Add CI and post-deploy audit gates

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/docker.yml`
- Create: `.github/workflows/web-production-audit.yml`
- Create: `scripts/tests/ci-web-audit-contract.test.mjs`
- Modify: `web/package.json`
- Modify: `deploy/compose/run.sh`
- Modify: `docs/web-production-audit-runbook.md`

1. Add a failing static contract test that requires unit/policy tests, manifest validation, deterministic Playwright, web build, and isolated relay-backed integration in `.github/workflows/ci.yml`.
2. Require `.github/workflows/docker.yml` to publish the exact image digest consumed by the production canary. Add `deploy/compose/run.sh asset-id` to print the running immutable image digest. Add a manually triggered, protected-environment production audit using secret browser-state/controller inputs and no fork/PR execution.
3. Configure artifact retention for secret-free reports only. Explicitly exclude Playwright storage state, raw traces from production, keys, NIP-44 plaintext, and full business event payloads.
4. Run action lint or the repository's workflow validation and observe failures before correction.
5. Implement the gates and document how a failed post-deploy audit blocks promotion/rollout without rolling back unrelated data automatically.
6. Run workflow validation, web checks, deterministic E2E, and integration E2E locally where supported.
7. Commit with `git commit -s -m "ci(web): gate route and production audits"`.

## Task 14: Execute the full local audit and fix every discovered defect

**Files:**

- Create: `test-results/web-audit/2026-08-30/local-summary.json`
- Create: `test-results/web-audit/2026-08-30/local-summary.md`

No product file is predeclared for this execution task. If a retained scenario exposes a defect, pause this task and append a TDD addendum naming the exact failing test and exact product files before editing them.

1. Run fresh checks in this order: web format/lint/typecheck, all Node policy tests, manifest validation, deterministic Playwright, isolated relay-backed Playwright, accessibility checks, and web production build.
2. For each failure, record severity, scenario ID, exact reproduction, expected/actual evidence, and affected route/feature before changing code.
3. Fix one defect at a time with its smallest retained failing test. Re-run the focused test, then the layer that exposed it. Never batch unrelated fixes under one unexplained commit.
4. Repeat until there are no unexplained skips, no missing manifest entries, no unexpected first-party errors, and no critical accessibility failures.
5. Produce secret-free local JSON/Markdown summaries containing asset hash, 28/28 route count, 22/22 feature count, scenario totals, timings, defects fixed/open, explicit safe skips, and cleanup status.
6. Commit intentional product fixes in separate signed commits, then commit the local audit evidence with `git commit -s -m "test(web): record exhaustive local audit"`.

## Task 15: Deploy the exact asset and run the production audit

**Files:**

- Create: `test-results/web-audit/2026-08-30/production-summary.json`
- Create: `test-results/web-audit/2026-08-30/production-summary.md`
- Create: `test-results/web-audit/2026-08-30/scheduled-reports.json`
- Create: `test-results/web-audit/2026-08-30/mutation-cleanup.json`

1. Verify all repository gates freshly, record the build asset hash, and deploy that exact asset through the existing web deployment path. Confirm `buzz.varvikstudios.com` serves the same identifier before canary actions.
2. Run the read-only production audit first: all routes allowed by current role, panels/menus, NIP-11 controller pin, relay/controller/canary service health, signed kind `10100` and kind `30181` consistency, console/request/WebSocket errors, and every scheduled report's last terminal result/next due time.
3. Confirm the pre-provisioned audit member, audit channel, and hosted canary IDs exactly match the policy. If any mismatch exists, stop before mutation and report the blocker; do not substitute a business target.
4. Run reversible canaries: name/avatar live propagation; active-task-safe model/effort change; access change; second-context/reload persistence; one isolated scheduled report; controller restart; runner restart; restoration of original name/avatar/model/effort/access and audit membership/channel state.
5. Rerun cleanup independently from a fresh browser/context and compare relay evidence to the recorded baseline. Material cleanup failure is a failed audit and blocks fleet rollout.
6. Run the scheduled-report auditor. Every enabled report must have a recent terminal success inside SLA or an explicit actionable failure; silence is not healthy.
7. Store only secret-free evidence: exact asset, route/feature/scenario totals, controller/runtime revisions, audit-only event IDs, timestamps, defect list, explicit safe skips, and cleanup proof.
8. Run `git status --short`, inspect artifacts for secrets/business content, and commit safe evidence with `git commit -s -m "test(web): record production audit"`.

## Task 16: Final repository verification and delivery report

**Files:**

- Create: `docs/web-production-audit-2026-08-30.md`

1. Run `./scripts/with-toolchain.ps1 just ci` and any package-local gates not included by `just ci`. Capture fresh terminal results before claiming completion.
2. Verify the working tree contains no accidental `.pnpm-store`, browser state, keys, production traces, mutation journals with secrets, or unrelated file changes in a commit.
3. Write the final report with the exact deployed asset, 28/28 routes, 22/22 features, scenario totals by layer, scheduled-report inventory results, runtime canary evidence, defects fixed, remaining defects with severity, safe skips, and verified cleanup.
4. Cross-link the runtime-control acceptance and web-audit evidence without duplicating sensitive data.
5. Commit with `git commit -s -m "docs(web): publish regression audit results"`.

## Plan self-review checklist

- All 28 generated routes and all 22 top-level features are named and machine-enforced.
- Every dynamic route includes valid and missing/unauthorized behavior, not only rendering.
- Policy, deterministic browser, relay-backed, and production layers have distinct purposes and commands.
- Hosted-agent model/effort/name/access behavior includes live propagation, reload, second context, busy task, scheduled report, restart, and cleanup.
- Scheduled reports fail on silence and duplicate terminal results rather than treating process health as delivery health.
- Production mutations are exact-target allowlisted, journaled before execution, reversible, and independently rechecked.
- Browser credentials, keys, traces, NIP-44 plaintext, and business payloads are excluded from artifacts.
- No task contains an unresolved marker, unspecified target, unbounded production write, or screenshot-only definition of coverage.

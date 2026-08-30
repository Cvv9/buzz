# Buzz web exhaustive regression audit

**Date:** 2026-08-30
**Status:** Draft for written-spec approval
**Scope:** Browser web client, relay-backed behavior, production deployment, and repeatable regression evidence

## Goal

Verify that every registered web route and every implemented web feature has a
meaningful automated scenario, then exercise the deployed browser application
with the owner's authenticated session. Changes made in one browser—especially
hosted-agent name, avatar, model, effort, and channel access—must be confirmed
through relay evidence, live propagation, reload, and a second browser context.

“Every feature” means every route in the generated route tree and every product
feature module under `web/src/features`. It does not mean every combinatorial
permutation of data, permissions, viewport, and network timing.

## Baseline and gap

The 2026-08-30 baseline has:

- 28 generated routes in `web/src/app/routeTree.gen.ts`;
- 22 feature directories under `web/src/features`;
- 14 Playwright spec files with 29 `test(...)` scenarios;
- no machine-enforced route-to-scenario manifest;
- strong workspace coverage, but incomplete explicit coverage for several
  settings, moderation, archive, pairing, repository/blob, forum, pulse, and
  error/offline routes;
- no repeatable post-deploy suite proving production live propagation.

The audit must close those gaps without using real business channels or agents
as disposable fixtures.

## Test architecture

Use four layers. A feature is not “covered” merely because a route renders.

| Layer | Purpose | Environment |
| --- | --- | --- |
| Policy/unit | Boundary values, parsers, event construction, permission rules, and failure paths | Node test runner |
| Deterministic browser E2E | Every route and interactive feature against the in-page relay mock | Built web client at `127.0.0.1:4173` |
| Relay-backed integration | Signing, authorization, storage, fan-out, and multi-client consistency | Isolated Postgres/Redis/relay stack |
| Production canary | Confirm the deployed assets, real relay, real owner policy, and safe live propagation | `https://buzz.varvikstudios.com` |

The production canary is not a substitute for deterministic tests. It uses a
small, explicitly isolated fixture set and never performs destructive checks
against business data.

## Coverage manifest

Add a checked-in manifest owned by the web test suite. Each entry contains:

```ts
type RouteCoverage = {
  route: string;
  feature: string;
  scenarioIds: string[];
  fixture: "mock" | "relay" | "production-canary";
  productionPolicy: "read" | "reversible-write" | "not-safe";
};
```

A CI check extracts every `fullPath` from `routeTree.gen.ts` and fails when a
route is missing from the manifest, duplicated, or mapped only to a screenshot.
A second check compares the 22 top-level feature directory names with the
manifest and fails when a feature has no scenario ID. Scenario IDs are stable
and are referenced from Playwright test titles, so a stale manifest cannot pass
after a test is removed.

### Route inventory

The initial manifest covers all 28 current routes:

```text
/
/workflows
/workflows/$workflowId
/settings
/search
/repos
/repos/$repoId
/repos/$repoId/blob/$
/repos/$repositoryAddress/work-items
/repos/$repositoryAddress/work-items/$workItemId
/reminders
/pulse
/projects
/projects/$projectAddress
/preferences
/pairing
/offline
/moderation
/identity-archive
/custom-emoji
/channel-state
/profiles/$pubkey
/messages/new
/messages/$channelId
/invite/$code
/huddles/$channelId
/channels/$channelId/posts
/channels/$channelId/posts/$postId
```

Dynamic routes use seeded, stable fixtures. They must also have a missing,
unauthorized, malformed, or deleted target scenario where that state is a
supported product outcome.

## Feature scenario matrix

### Access, identity, and navigation

- first load, sign-in, sign-out, recovery key import/export, locked/unlocked
  state, session persistence, and identity archive/unarchive;
- invite consent, invalid/expired invite, enrollment, and post-enrollment route;
- sidebar navigation, browser back/forward, direct deep links, unknown route,
  reload, and cross-community state isolation;
- owner, member, and unauthorized presentations for owner-only controls;
- workspace appearance, theme, density/zoom where supported, preferences, and
  browser-local device settings.

### Channels and communication

- channel creation/editing, membership, hosted-agent channel access, leave,
  deletion safeguards, hidden/read state, unread counts, and live fan-out;
- new message, edit/delete where supported, mentions, replies, nested threads,
  reactions, pins/bookmarks if exposed, attachments, media failure, and search;
- forum list/post/comment/deep-link behavior and channel-state diagnostics;
- presence and typing indicators, including teardown on navigation/reconnect;
- custom emoji create/use/remove and missing-media fallback;
- huddle start/join/reaction/history/end plus microphone denial and teardown.

### Hosted agents

- directory discovery from self-authored kind `10100` only;
- owner-only add/edit/archive/channel-access affordances;
- name/avatar edit accepted by relay, visible in the current browser, live in a
  second browser, and still correct after reload;
- separate model and effort controls with normalized unique base models;
- current, pending-busy, applying, applied, failed, retry, restart, and stale
  acknowledgment states from the runtime-settings design;
- an active canary task is not cancelled; the next message and scheduled task
  use the new global defaults;
- direct legacy kind `30180.model` changes cannot spoof the effective runtime;
- duplicate provider rows, unsupported effort, unauthorized viewer, controller
  unavailable, and stale catalog behavior.

### Work management

- reminders create/edit/complete/delete, due-state rendering, DM and channel
  scope, and live updates;
- workflows create/edit/toggle, conditions, runs, approval grant/deny,
  unauthorized approval, failure, and disabled-workflow behavior;
- projects list/detail, task state, project deep links, and missing project;
- pulse summaries and empty/error states;
- repositories list/detail, blob browsing, invalid path, work-item list/detail,
  state transitions, and repository authorization.

### Scheduled-report reliability

- inventory every deployed scheduled report by agent, cadence, destination,
  last terminal result, and next due time;
- require a recent success inside the schedule's SLA or an explicit actionable
  failure—silence is a failed state, not “healthy”;
- trigger one isolated canary schedule, prove the agent claims it once, publishes
  a terminal report once, and records the expected model/effort revision;
- restart the canary runner and prove the schedule remains registered without a
  duplicate execution;
- correlate container health, relay presence, workflow run, and published
  message so a green health probe alone cannot satisfy the check.

### Safety and resilience

- moderation report queue, owner action, redacted member view, timeout/ban and
  exact reversal using only the audit member;
- offline archive seed, offline route, reconnect, stale data indication, and
  no cross-community cache leakage;
- pairing QR/manual flow, invalid/expired payload, cancellation, and local-device
  cleanup without pairing a production device;
- first-party HTTP/WebSocket failures, reconnect, duplicate events, out-of-order
  replaceable heads, malformed events, and empty states;
- no unexpected `console.error`, unhandled rejection, failed same-origin
  request, hydration error, or accessibility-critical violation.

## Browser scenario contract

Every Playwright scenario must assert at least one product outcome, not only
visibility. Mutation scenarios assert all applicable stages:

1. the control sends the expected signed event or request;
2. the relay/mock explicitly accepts it;
3. local UI state changes;
4. a second independent page/context receives the live update;
5. reload reconstructs the same state from the authoritative query;
6. unauthorized and stale competing events do not win;
7. cleanup returns the fixture to its recorded baseline.

Each page installs listeners before navigation for:

- `pageerror`;
- unexpected `console.error` and `console.warn` allowlisted by exact known case;
- failed same-origin requests and WebSocket protocol errors;
- uncaught promise rejections;
- accessibility checks on the affected region.

Animations settle before screenshots. Screenshots are scoped to the relevant
locator or overlay and are evidence, never the sole assertion.

## Deterministic E2E organization

Retain focused specs rather than one enormous “click everything” test. Extend
`workspaceRelayMock.ts` only with protocol behavior shared by several specs;
feature-specific fixture builders live beside their specs.

New/expanded suites are grouped by responsibility:

```text
route-coverage.spec.ts
workspace-shell-and-access.spec.ts
workspace-channels-and-messages.spec.ts
workspace-hosted-agent-runtime.spec.ts
workspace-safety-and-resilience.spec.ts
work-management.spec.ts
repos-and-forums.spec.ts
```

Existing focused specs may remain when they already express the behavior
clearly. `web/playwright.config.ts` registers every suite through a deliberate
glob or explicit list that the manifest check also validates. No checked-in
spec may be silently omitted from the Playwright project.

## Relay-backed integration environment

The integration suite starts the repository's isolated relay stack and creates
fresh cryptographic identities for:

- community owner;
- ordinary member;
- audit member used for moderation/archive reversals;
- hosted canary agent;
- pinned runtime controller.

It creates one audit-only channel, workflow, project/repository fixtures where
supported, and a hosted canary profile. Tests use explicit event kinds and `h`
tags for channel-scoped events. They verify persisted queries as well as live
subscriptions and do not share state with production.

The suite owns its database namespace and tears it down as a unit. A failed
test retains logs and traces but never reuses partially mutated state on retry.

## Production canary safety

Production testing uses the owner's existing authenticated Chrome session for
owner-only views and a pre-provisioned audit member/hosted canary for mutations.
All generated names start with `e2e-audit-<UTC timestamp>-`.

Before the first write, the runner creates a durable local mutation journal:

```json
{
  "run_id": "20260830T...",
  "target": "buzz.varvikstudios.com",
  "original_values": {},
  "created_event_ids": [],
  "cleanup_actions": [],
  "cleanup_complete": false
}
```

Every reversible write records its inverse before execution. Cleanup runs in a
`finally` block and is then independently verified by a new query. An
interrupted run begins by discovering and cleaning stale `e2e-audit-*`
fixtures. Material cleanup failures stop the audit and are reported; they are
never hidden by subsequent tests.

### Allowed production actions

- read every route and open every non-destructive panel/menu;
- create/send/edit/react/reply/remind/workflow/huddle only in the audit channel;
- upload one small, non-sensitive generated fixture and request its supported
  deletion;
- mutate only the hosted canary's name/avatar/model/effort/access, then restore
  and verify its exact original values;
- moderate/archive only the audit member, immediately reverse the action, and
  verify access is restored;
- create a short-lived invite whose secret is never written to logs or
  screenshots;
- change browser-local preferences and restore them.

### Prohibited production actions

- renaming or changing runtime settings for a business agent;
- posting in a business/client channel;
- modifying real members, projects, repositories, workflows, or moderation
  records;
- approving a workflow with an external side effect;
- deleting pre-existing data;
- printing keys, invite secrets, auth headers, NIP-44 plaintext, or cookies;
- pairing a real device solely for the audit.

Unsupported destructive paths are fully tested in the isolated relay and only
inspected read-only in production.

## Production deployment checks

Before browser interaction, record:

- deployed page asset hashes and build/version metadata;
- NIP-11 relay metadata and hosted runtime controller key;
- `/health` status and WebSocket connection result;
- service health for relay, controller, and hosted canary;
- the canary's signed kind `10100` runtime revision and controller kind `30181`
  status;
- every deployed report's last terminal result and next due time.

After deployment, run a fresh browser context with cache disabled once to avoid
mistaking a stale bundle for the deployed build. Then repeat the core live-sync
scenario in two contexts with normal caching. The audit fails if the HTML points
to an old asset, a service worker serves a stale build, or a requested agent
change appears only as a local optimistic state.

Buzz remains a browser web application, not a required desktop shell. The audit
does not assume Tauri APIs and does not claim offline installability; PWA
manifest/service-worker installation is outside this scope.

## Evidence and reporting

Each run writes under `test-results/web-audit-<UTC timestamp>/`:

- Playwright HTML report, traces, and failure screenshots;
- route/feature coverage JSON;
- sanitized console/network summary;
- relay/controller/agent correlation IDs for runtime mutations;
- mutation journal and cleanup verification;
- deployed asset/version snapshot;
- a machine-readable per-scenario result.

A human summary is written to `docs/web-audits/<date>.md` with:

- environment and deployed revision;
- route and feature coverage totals;
- PASS/FAIL/SKIPPED with evidence for every scenario ID;
- defects with reproduction steps and severity;
- explicit skips and the reason they were unsafe or unavailable;
- cleanup status and any remaining fixture IDs.

A production audit is successful only when there are no unexplained skips, no
unreverted material mutations, no critical accessibility failures, and every
registered route and feature has passing deterministic coverage. A production
capability that cannot be safely mutated must still pass isolated integration
coverage and a production read-only smoke check.

## CI and release gates

The implementation adds these gates:

1. web unit/policy tests;
2. route/feature manifest validation;
3. all deterministic Playwright specs;
4. relay-backed integration suite for changes touching auth, persistence, or
   live sync;
5. repository `just ci` before deployment;
6. manually triggered, credentialed production canary after deployment.

The production canary is not run for untrusted pull requests and its browser
state/credentials are never uploaded as artifacts. A failed post-deploy canary
blocks rollout to the remaining hosted-agent fleet and triggers the documented
rollback.

## Definition of done

- Every generated route and top-level web feature maps to at least one passing
  scenario enforced by CI.
- Every user-visible mutating control has acceptance, live propagation, reload,
  authorization, and failure coverage where applicable.
- Hosted-agent name, avatar, model, effort, and channel access are verified in
  two browser contexts against authoritative relay/controller/agent evidence.
- Active work survives a queued runtime change and the next scheduled report
  uses the applied per-agent defaults.
- All relevant unit, E2E, integration, build, formatting, and static checks pass.
- The deployed production asset is the tested asset.
- Production canary cleanup is independently verified and the evidence report
  contains no secret material.

## Out of scope

- Exhaustive browser-engine certification beyond the supported matrix.
- Real destructive operations against business data.
- Real external workflow side effects such as email, payments, or deployments.
- Desktop/Tauri-only behavior and mobile Flutter behavior.
- PWA installation/offline service-worker implementation.

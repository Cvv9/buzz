# Hosted-Agent Runtime Settings Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task with test-driven development.

**Goal:** Make each hosted agent's model, reasoning effort, and runtime name truthful, owner-controlled, durable across restarts, and applied only after all active work finishes.

**Architecture:** The browser publishes an encrypted owner-authored runtime request to a relay-pinned controller. The controller validates the agent-signed catalog, persists a monotonic per-agent revision, and sends an encrypted control frame to `buzz-acp`. The runner quiesces dispatch without cancelling active turns, atomically applies model, effort, and runtime name to every future session, publishes a signed kind `10100` acknowledgment, and resumes queued work. Controller kind `30181` is the public pending/applied truth; kind `30180.model` remains legacy compatibility data and never becomes runtime truth.

**Tech Stack:** Rust 2021 (`buzz-core`, `buzz-sdk`, `buzz-relay`, `buzz-acp`, new `buzz-runtime-controller`), Nostr/NIP-44, Tokio, Redis replay protection, React 19, TypeScript, TanStack Query, Node test runner, Playwright, Docker Compose, PowerShell toolchain wrapper.

**Spec:** `docs/superpowers/specs/2026-08-30-hosted-agent-runtime-settings-design.md`

**Global Constraints:** Keep the browser deployment as the primary product; do not add PWA or desktop-only control behavior. Preserve the exact kind `30180` v1 shape, but never write a runtime selection into it or project its legacy `model` as effective. Authorize hosted-agent mutations only for the exact current community owner. Never cancel an active turn for a runtime change. Do not add per-channel, per-workflow, per-message, or provider overrides. Never pass browser input to a shell. Keep controller state and audit files root-readable only. Preserve the user's unrelated desktop edits. Use `./scripts/with-toolchain.ps1` for Rust, Node, Git, and hook commands on Windows. Every implementation task follows red-test, observed failure, minimal implementation, observed pass, then a signed atomic commit.

---

## Task 1: Add shared runtime protocol types

**Files:**

- Modify: `crates/buzz-core/Cargo.toml`
- Modify: `crates/buzz-core/src/lib.rs`
- Modify: `crates/buzz-core/src/kind.rs`
- Create: `crates/buzz-core/src/hosted_agent_runtime.rs`
- Test: `crates/buzz-core/src/hosted_agent_runtime.rs`

1. Add failing unit tests for:
   - `24201` being ephemeral and present in `ALL_KINDS`;
   - `30181` being parameterized replaceable and present in `ALL_KINDS`;
   - exact deserialization and rejection of unknown fields for request, status, runtime acknowledgment, model-family, selection, and redacted-error schemas;
   - recognized effort values `low`, `medium`, `high`, `xhigh`, `max`, `ultra` and rejection of every other string;
   - lowercase 64-character pubkeys, UUID v4 request IDs, nonzero monotonic revisions, and the exact five fixed status states;
   - stable SHA-256 catalog digests when input order or duplicate source rows differ, while a binding change changes the digest.
2. Run `./scripts/with-toolchain.ps1 cargo test -p buzz-core hosted_agent_runtime -- --nocapture` and verify compilation or assertions fail because the protocol does not exist.
3. Add `KIND_HOSTED_AGENT_RUNTIME_REQUEST` and `KIND_HOSTED_AGENT_RUNTIME_STATUS`, compile-time range assertions, and shared strict serde types. The normalized catalog digest must sort families, efforts, and private bindings deterministically before serialization.
4. Run the focused test again, then `./scripts/with-toolchain.ps1 cargo test -p buzz-core kind -- --nocapture`; both must pass.
5. Commit only this task's files with `git commit -s -m "feat(core): define hosted runtime protocol"`.

## Task 2: Add canonical event builders and the compatible agent profile builder

**Files:**

- Modify: `crates/buzz-sdk/src/builders.rs`
- Modify: `crates/buzz-sdk/src/lib.rs`
- Modify: `crates/buzz-cli/src/commands/agents.rs`
- Modify: `crates/buzz-cli/src/lib.rs`
- Test: `crates/buzz-sdk/src/builders.rs`
- Test: `crates/buzz-cli/src/commands/agents.rs`

1. Add failing builder tests that assert exact tags and content boundaries:
   - runtime request has one each of `p`, `agent`, `request`, and `expiration`, with no extra routing tags;
   - controller status has exactly `d=<agent pubkey>`;
   - runtime control and receipt frames use the existing encrypted observer envelope and identify `apply_runtime_defaults` without exposing model data in tags;
   - agent profile building preserves all unmodeled top-level fields while replacing `name`, `display_name`, `model`, `model_families`, and `runtime` atomically.
2. Add failing CLI tests showing `publish-profile` accepts normalized `--model-families-json` and optional `--runtime-json`, rejects non-arrays/non-objects and unknown runtime fields, and keeps the flat `models` compatibility array.
3. Run `./scripts/with-toolchain.ps1 cargo test -p buzz-sdk hosted_runtime -- --nocapture` and `./scripts/with-toolchain.ps1 cargo test -p buzz-cli publish_profile -- --nocapture`; observe the missing builders/options fail.
4. Implement SDK builders using the shared strict protocol types. Refactor CLI profile construction through the compatible builder rather than hand-building kind `10100` in the command.
5. Re-run both focused suites and `./scripts/with-toolchain.ps1 cargo test -p buzz-sdk -p buzz-cli`; all must pass.
6. Commit with `git commit -s -m "feat(sdk): build hosted runtime events"`.

## Task 3: Advertise and validate the pinned controller at relay startup

**Files:**

- Modify: `.env.example`
- Modify: `crates/buzz-relay/src/config.rs`
- Modify: `crates/buzz-relay/src/nip11.rs`
- Modify: `crates/buzz-relay/src/main.rs`
- Test: `crates/buzz-relay/src/config.rs`
- Test: `crates/buzz-relay/src/nip11.rs`

1. Add failing tests that require:
   - `BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY` to accept only lowercase 64-character hex when nonempty;
   - malformed configuration to fail startup instead of disabling the feature silently;
   - NIP-11 to omit `buzz_hosted_agent_runtime` when unset and emit exactly `{version:1,controller_pubkey,request_kind:24201,status_kind:30181}` when set.
2. Run `./scripts/with-toolchain.ps1 cargo test -p buzz-relay config::tests -- --nocapture` and `./scripts/with-toolchain.ps1 cargo test -p buzz-relay nip11::tests -- --nocapture`; observe failures.
3. Add the typed config field and typed NIP-11 extension. Pass configuration through every NIP-11 construction path and document the variable in `.env.example`.
4. Re-run the focused tests and `./scripts/with-toolchain.ps1 cargo check -p buzz-relay`; both must pass.
5. Commit with `git commit -s -m "feat(relay): advertise runtime controller"`.

## Task 4: Enforce owner-only runtime requests with shared replay protection

**Files:**

- Create: `crates/buzz-relay/src/hosted_agent_runtime.rs`
- Modify: `crates/buzz-relay/src/lib.rs`
- Modify: `crates/buzz-relay/src/handlers/event.rs`
- Modify: `crates/buzz-relay/src/handlers/req.rs`
- Modify: `crates/buzz-relay/src/state.rs`
- Modify: `crates/buzz-core/src/filter.rs`
- Test: `crates/buzz-relay/src/hosted_agent_runtime.rs`
- Test: `crates/buzz-relay/src/handlers/event.rs`
- Test: `crates/buzz-relay/src/handlers/req.rs`
- Test: `crates/buzz-test-client/tests/e2e_managed_agent.rs`

1. Add failing pure-envelope tests for exact tag cardinality, lowercase target, UUID v4 request tag, expiration no more than five minutes ahead, event freshness, non-plaintext NIP-44 content, and configured-controller match.
2. Add failing authorization tests for owner accepted; admin, declared agent owner, agent itself, ordinary member, and cross-tenant identity rejected. Require a current self-authored kind `10100` for the target.
3. Add failing replay tests against Redis semantics: first UUID accepted, same UUID rejected across two `AppState` instances, and UUID reusable only after the bounded replay TTL.
4. Add failing p-gate tests proving only the authenticated pinned controller may subscribe to kind `24201` and only with its matching `#p` filter. No other subscriber receives live fan-out.
5. Run the focused relay tests and observe failures before implementation.
6. Implement a single `validate_hosted_agent_runtime_request` path before the generic ephemeral branch. Use Redis `SET key value NX EX` with a controller/community/request namespace; do not use an in-process set. Publish accepted requests live without storing them.
7. Extend result-level p-gating in `buzz-core` so kindless or ID-based delivery cannot bypass the runtime request gate.
8. Re-run the focused relay tests, then `./scripts/with-toolchain.ps1 cargo test -p buzz-relay hosted_agent_runtime -- --nocapture` and the targeted `buzz-test-client` test.
9. Commit with `git commit -s -m "feat(relay): authorize runtime requests"`.

## Task 5: Store controller status and centralize hosted-agent mutation policy

**Files:**

- Create: `crates/buzz-relay/src/hosted_agent_policy.rs`
- Modify: `crates/buzz-relay/src/lib.rs`
- Modify: `crates/buzz-relay/src/handlers/ingest.rs`
- Modify: `crates/buzz-relay/src/handlers/side_effects.rs`
- Modify: `crates/buzz-relay/src/handlers/event.rs`
- Test: `crates/buzz-relay/src/hosted_agent_policy.rs`
- Test: `crates/buzz-relay/src/handlers/ingest.rs`
- Test: `crates/buzz-relay/src/handlers/side_effects.rs`

1. Write failing policy-table tests for four hosted actions: presentation update, runtime request, hosted-agent channel membership mutation, and hosted-agent archive/delete. Exact community owner is allowed; admin, channel admin, declared owner, ordinary member, and event-claimed role are denied. Add a separate control proving ordinary human channel moderation retains its current owner/admin rules.
2. Write failing kind `30181` ingest tests for exact `d` target, strict secret-free schema, pinned-controller author, global-only storage, replaceable newest-head semantics, and rejection of host path, service name, prompt, command, or unknown fields.
3. Run the focused tests and observe current admin/declared-owner acceptance and missing status handling fail the new contract.
4. Implement `hosted_agent_action_authorized` as the one policy entrypoint. Route kind `30180`, runtime requests, hosted target membership changes, and hosted archive/delete through it. Do not change ordinary channel moderation.
5. Add kind `30181` validation, controller-author check, storage/fan-out classification, and scope mapping.
6. Re-run focused tests and `./scripts/with-toolchain.ps1 cargo test -p buzz-relay`; all must pass.
7. Commit with `git commit -s -m "feat(relay): enforce hosted agent owner policy"`.

## Task 6: Normalize adapter catalogs into model families and exact bindings

**Files:**

- Create: `crates/buzz-acp/src/runtime_catalog.rs`
- Modify: `crates/buzz-acp/src/lib.rs`
- Modify: `crates/buzz-acp/src/acp.rs`
- Modify: `deploy/compose/agent-entrypoint.sh`
- Create: `deploy/compose/tests/agent-entrypoint-models.bats`
- Test: `crates/buzz-acp/src/runtime_catalog.rs`

1. Add failing table tests using real catalog shapes from stable `configOptions` and unstable `models.availableModels`. Cover `name` and legacy `displayName`, descriptions, exact IDs such as `gpt-5.6-sol[high]`, labels such as `GPT-5.6-Sol (high)`, duplicate aliases, identical labels with different IDs, unsupported effort suffixes, and the `Runtime default` pseudo-option.
2. Assert one public row per base family, ordered supported efforts, verified default effort, deterministic digest, and a private map `(base, effort) -> {method, exact_selection_id}` with stable-config priority over unstable-model priority.
3. Run `./scripts/with-toolchain.ps1 cargo test -p buzz-acp runtime_catalog -- --nocapture` and observe the module is missing.
4. Implement normalization in Rust and make `buzz-acp models --json` emit both compatibility source data and the canonical family/binding result. The shell entrypoint must consume the canonical output rather than independently guessing names.
5. Add an entrypoint test that proves repeated `GPT-3.5-Turbo-16k` labels collapse only when they resolve to the same canonical family/effort, while genuinely different exact bindings remain private diagnostics and never create duplicate browser rows.
6. Run the focused Rust and entrypoint suites, then `./scripts/with-toolchain.ps1 cargo test -p buzz-acp`.
7. Commit with `git commit -s -m "fix(acp): normalize runtime model catalogs"`.

## Task 7: Add an agent-global quiescing runtime state machine

**Files:**

- Create: `crates/buzz-acp/src/runtime_defaults.rs`
- Modify: `crates/buzz-acp/src/pool.rs`
- Modify: `crates/buzz-acp/src/queue.rs`
- Modify: `crates/buzz-acp/src/lib.rs`
- Test: `crates/buzz-acp/src/runtime_defaults.rs`
- Test: `crates/buzz-acp/src/pool.rs`
- Test: `crates/buzz-acp/src/pool_lifecycle.rs`

1. Write failing deterministic state-machine tests for:
   - idle apply invalidating every channel session and changing all later claims;
   - one and multiple active turns completing normally with zero cancellation signals;
   - new relay messages being accepted into the existing queue while dispatch is suspended;
   - the last active result triggering apply before the next queued claim;
   - model and effort applying together or rolling back together;
   - higher revision superseding a pending lower revision, while stale/equal revisions are idempotent;
   - no task source being able to supply a model or effort override.
2. Add a probe-failure test that restores prior defaults, discards the partial session, resumes dispatch, and returns a fixed error code.
3. Run `./scripts/with-toolchain.ps1 cargo test -p buzz-acp runtime_defaults -- --nocapture` and observe failures.
4. Implement `RuntimeDefaults`, `PendingRuntimeRevision`, and explicit `Current`, `Quiescing`, and `Applying` states in `AgentPool`. Gate `try_claim` while quiescing/applying; never send `ControlSignal::SwitchModel` from this path. Apply exact selection IDs to all owned agents, invalidate all sessions, probe one fresh session, then atomically publish the new effective state to the pool.
5. Re-run focused tests and the full `buzz-acp` unit suite.
6. Commit with `git commit -s -m "feat(acp): quiesce runtime changes between turns"`.

## Task 8: Accept controller frames and publish exact signed runtime acknowledgments

**Files:**

- Create: `crates/buzz-acp/src/runtime_control.rs`
- Create: `crates/buzz-acp/src/runtime_profile.rs`
- Modify: `crates/buzz-acp/src/config.rs`
- Modify: `crates/buzz-acp/src/lib.rs`
- Modify: `crates/buzz-acp/src/pool.rs`
- Create: `crates/buzz-acp/src/runtime_identity.rs`
- Modify: `crates/buzz-acp/README.md`
- Test: `crates/buzz-acp/src/runtime_control.rs`
- Test: `crates/buzz-acp/src/runtime_profile.rs`
- Test: `crates/buzz-acp/src/lib.rs`

1. Add failing tests that accept `apply_runtime_defaults` only from `BUZZ_ACP_RUNTIME_CONTROLLER_PUBKEY`, reject owner `switch_model` with `managed_by_controller`, reject stale revision/digest/unsupported bindings, and preserve existing owner-only cancel/steer controls.
2. Add failing tests that a runtime name affects the next session title/prompt context but not the signing pubkey, and that the signed kind `10100` merge preserves aliases, about, resources, access, avatar, flat models, and unknown compatibility fields.
3. Add failing acknowledgment tests requiring exact controller pubkey, revision, base model, effort, effective name, and catalog digest; a rollback republishes the prior effective acknowledgment and emits an encrypted fixed-code failure receipt.
4. Run focused tests and observe failures.
5. Implement controller subscription/routing on the existing kind `24200` observer transport. Add a mutable agent-global runtime identity used only when new sessions are built. Query and merge the current self-authored profile before publishing the acknowledgment so replaceable data is never truncated.
6. Ensure startup suspends new task dispatch until the configured controller has reconciled the latest desired/effective revision or the signed current status proves there is no pending revision. Do not drop inbound messages during this gate.
7. Re-run focused and full `buzz-acp` tests.
8. Commit with `git commit -s -m "feat(acp): apply controller runtime revisions"`.

## Task 9: Implement the durable runtime controller service

**Files:**

- Modify: `Cargo.toml`
- Create: `crates/buzz-runtime-controller/Cargo.toml`
- Create: `crates/buzz-runtime-controller/src/main.rs`
- Create: `crates/buzz-runtime-controller/src/config.rs`
- Create: `crates/buzz-runtime-controller/src/state_store.rs`
- Create: `crates/buzz-runtime-controller/src/controller.rs`
- Create: `crates/buzz-runtime-controller/src/reconcile.rs`
- Create: `crates/buzz-runtime-controller/src/audit.rs`
- Create: `crates/buzz-runtime-controller/tests/reconciliation.rs`

1. Write failing config tests for relay URL, controller private key, fixed owner pubkey, state/audit paths, and fixed JSON agent-pubkey-to-service mapping. Reject duplicate pubkeys, relative paths, unknown fields, and invalid service identifiers.
2. Write failing state-store tests for atomic sibling-temp write, fsync-before-rename, restrictive file mode on Unix, monotonic per-agent revisions, request UUID idempotency, append-only redacted audit entries, and recovery from a complete prior file without accepting a partial temp file.
3. Write failing reconciliation tests using an in-memory transport: valid request, unsupported/stale catalog, offline agent, controller restart, runner restart, pending supersession, applying supersession, mismatched acknowledgment, correct acknowledgment, and fixed redacted failure messages.
4. Run `./scripts/with-toolchain.ps1 cargo test -p buzz-runtime-controller -- --nocapture` and observe the crate or tests fail.
5. Implement the controller with `buzz-ws-client`: authenticate, subscribe to controller-addressed `24201`, agent kind `10100`, controller status `30181`, and controller-addressed result frames; decrypt request; repeat owner/target/freshness/digest/allowlist checks; persist desired state; publish status; send encrypted apply control; reconcile exact acknowledgment.
6. Keep the service/provider map private. Never place service names, host paths, adapter output, commands, or prompts in `30181` or logs. Map all user-visible failures to the spec's fixed vocabulary.
7. Run the focused suite, full crate suite, and `./scripts/with-toolchain.ps1 cargo clippy -p buzz-runtime-controller --all-targets -- -D warnings`.
8. Commit with `git commit -s -m "feat(runtime): add hosted agent controller"`.

## Task 10: Wire controller and fleet deployment with health checks

**Files:**

- Modify: `deploy/compose/compose.yml`
- Modify: `deploy/compose/agent-entrypoint.sh`
- Modify: `deploy/compose/.env.example`
- Create: `deploy/compose/runtime-controller-entrypoint.sh`
- Create: `deploy/compose/tests/runtime-controller-compose.bats`
- Modify: `deploy/compose/run.sh`
- Modify: `docs/hosted-agent-runtime-control.md`

1. Add failing static/deployment tests that require a controller service, read-only image filesystem where supported, root-only state/audit volume, independent health check, `restart: unless-stopped`, pinned controller pubkey in relay and every runner, and no Docker socket or owner/controller private key in agent containers.
2. Add a failing rolling-order test that validates relay/controller compatibility deploys before canary runner and fleet rollout.
3. Run the compose/static tests and observe missing service/env wiring.
4. Add the controller service and runner environment. The controller key stays only in controller secrets; runners receive only its public key. Extend `deploy/compose/run.sh` health verification to include controller state and each runner without reintroducing process-spawning health probes.
5. Write `docs/hosted-agent-runtime-control.md` with configuration, state recovery, status interpretation, alert conditions, canary rollout, rollback, and key rotation procedure.
6. Run `docker compose -f deploy/compose/compose.yml config`, the deployment tests, and shell lint through the repository toolchain.
7. Commit with `git commit -s -m "feat(deploy): run hosted runtime controller"`.

## Task 11: Make web runtime state cryptographically truthful

**Files:**

- Modify: `web/src/shared/lib/nostr-signer.ts`
- Modify: `web/src/features/workspace/workspace-api.ts`
- Modify: `web/src/features/workspace/workspace-agent-models.ts`
- Create: `web/src/features/workspace/workspace-agent-runtime.ts`
- Create: `web/tests/workspace-agent-runtime-policy.test.ts`
- Modify: `web/tests/workspace-hosted-agent-config-policy.test.ts`

1. First change tests to fail on the current lie: `applyHostedAgentConfigs` must preserve the signed effective runtime even when kind `30180.model` differs. Presentation edits must preserve the existing legacy `model` value, and a pure runtime selection must not publish kind `30180`.
2. Add failing model-family tests for stable/unstable source aliases, duplicate `GPT-3.5-Turbo-16k` labels, descriptions, supported-effort filtering, exact binding presence, pseudo-option rejection, and deterministic catalog digest agreement with Rust fixtures.
3. Add failing request/status tests for NIP-11 pin discovery, recipient NIP-44 encryption for browser key and NIP-07 signer, exact request tags/payload, expiration, controller-author verification, strict status schema, newest revision selection, and `current/pending_busy/applying/applied/failed` projection.
4. Run `./scripts/with-toolchain.ps1 node --experimental-strip-types --test web/tests/workspace-agent-runtime-policy.test.ts web/tests/workspace-hosted-agent-config-policy.test.ts` and observe failures.
5. Implement recipient encryption, normalized web catalog parsing, trusted runtime query/subscription, and request construction. Extend directory subscriptions and query keys for kind `30181`. Remove the kind `30180.model` overlay.
6. Re-run focused tests and `./scripts/with-toolchain.ps1 pnpm --dir web test`.
7. Commit with `git commit -s -m "feat(web): trust controller runtime status"`.

## Task 12: Split Model and Reasoning effort and show safe-boundary status

**Files:**

- Modify: `web/src/features/workspace/ui/WorkspaceAgents.tsx`
- Modify: `web/src/features/workspace/ui/WorkspacePage.tsx`
- Modify: `web/tests/e2e/helpers/workspaceRelayMock.ts`
- Modify: `web/tests/e2e/workspace-identity-and-agents.spec.ts`
- Create: `web/tests/e2e/workspace-hosted-agent-runtime.spec.ts`

1. Add failing Playwright scenarios with stable IDs for:
   - owner sees separate Model and Reasoning effort controls; admin/member controls are disabled with exact explanation;
   - changing model filters efforts and never produces duplicate family rows;
   - save of runtime-only fields emits `24201` but not `30180`;
   - name/avatar presentation updates live in a second context and after reload;
   - busy status reads “Queued — applies after current work finishes”, then applying and applied states update live;
   - failed status exposes fixed retry action;
   - reload and second context restore pending state from controller status;
   - keyboard labels, focus order, and narrow viewport remain usable.
2. Run only the new E2E spec and observe failures against the existing combined selector.
3. Split the form state into base model and effort. Initialize from signed `10100.runtime` plus trusted pending status. Publish kind `30180` only for name/avatar changes and wait for its acceptance; publish the encrypted runtime request for model, effort, or runtime-name reconciliation. Resolve save only to accepted/queued status, never falsely to applied.
4. Change management capability to exact community owner. Keep status visible read-only to other authorized viewers.
5. Re-run the new spec, existing identity/agent spec, web typecheck, and web build.
6. Commit with `git commit -s -m "feat(web): separate model and effort controls"`.

## Task 13: Add relay-backed end-to-end runtime boundary tests

**Files:**

- Create: `crates/buzz-test-client/tests/e2e_hosted_agent_runtime.rs`
- Modify: `TESTING.md`
- Modify: `crates/buzz-cli/TESTING.md`

1. Write an ignored relay-backed test that creates owner/admin/member/controller/agent identities and proves request authorization, controller-only delivery, encrypted controller command, no active-turn cancellation, queued dispatch, signed acknowledgment, status replacement, second-client live propagation, and persistence through controller and runner restart.
2. Add negative integration cases for cross-community agent, replayed UUID, wrong controller, admin mutation, stale catalog, mismatched acknowledgment, and adapter rollback.
3. Run the test before wiring its helpers and observe failure.
4. Implement only the missing integration fixtures; do not weaken production validation paths for the test.
5. Run `./scripts/with-toolchain.ps1 cargo test -p buzz-test-client --test e2e_hosted_agent_runtime -- --ignored --nocapture` against the isolated stack and preserve the command/evidence format in `TESTING.md`.
6. Commit with `git commit -s -m "test(runtime): cover hosted agent reconciliation"`.

## Task 14: Update the cross-surface contract and compatibility consumers

**Files:**

- Modify: `docs/agent-surface-map.md`
- Modify: `VISION_AGENT.md`
- Modify: `VISION_REMOTE_AGENTS.md`
- Modify: `desktop/src/features/agents/lib/hostedAgentPresentation.ts`
- Modify: `desktop/src/features/agents/ui/HostedAgentEditDialog.tsx`
- Modify: `desktop/src/features/agents/lib/agentSurfaceMapContract.test.mjs`
- Modify: `desktop/src-tauri/src/commands/agent_models.rs`
- Modify: `desktop/src-tauri/src/commands/agent_models_tests.rs`

1. Add failing desktop compatibility tests that stop showing kind `30180.model` as effective, parse `model_families` and `10100.runtime`, collapse duplicate labels, and render runtime editing as web-managed/read-only when controller management is advertised.
2. Run the focused desktop frontend and Tauri tests and observe failure.
3. Implement only truthful compatibility behavior; do not create a second desktop controller path. Reconcile the existing uncommitted desktop model-discovery edits rather than overwriting or reverting them.
4. Update the surface map's source-of-truth table, hosted edit flow, consumer matrix, invalidation routes, and required tests. Update `VISION_AGENT.md` and `VISION_REMOTE_AGENTS.md` to record the approved intentional move from restart-only runtime changes to controller-mediated live quiescing.
5. Re-run desktop focused tests, Tauri focused tests, typecheck, and map contract test.
6. Commit with `git commit -s -m "docs(agents): map durable runtime control"`.

## Task 15: Run full gates, deploy canary-first, and prove production behavior

**Files:**

- Create: `test-results/runtime-control/2026-08-30-runtime-acceptance.json`

1. Run fresh repository gates:
   - `./scripts/with-toolchain.ps1 cargo fmt --all -- --check`
   - `./scripts/with-toolchain.ps1 cargo clippy --workspace --all-targets -- -D warnings`
   - `./scripts/with-toolchain.ps1 cargo test --workspace`
   - `./scripts/with-toolchain.ps1 pnpm --dir web test`
   - `./scripts/with-toolchain.ps1 pnpm --dir web build`
   - `./scripts/with-toolchain.ps1 pnpm --dir web exec playwright test`
   - the focused desktop compatibility commands from Task 14.
2. Record exact pass/fail output. Fix failures with the same red-green discipline and separate signed commits; never describe an unrun gate as passing.
3. Deploy relay and controller compatibility, confirm NIP-11 pin and controller health, then deploy one dedicated canary runner. Do not roll the fleet until the canary acceptance sequence passes.
4. In the canary, start a deliberately blocked task, request a new model and effort, and prove no cancellation frame or duplicate terminal result occurs. Finish the task; prove queued work starts only after matching kind `10100` acknowledgment and kind `30181` applied state.
5. Trigger one canary scheduled report, prove one claim and one terminal report with the new revision, restart controller and runner separately, and prove the selection survives. Restore the original canary model/effort/name and independently verify cleanup.
6. Roll the remaining fleet, inspect all hosted profiles/statuses, and store a secret-free JSON evidence record with deployment asset version, event IDs, revisions, timestamps, health, and cleanup state.
7. Run `git status --short`, confirm only intentional files remain, and commit the evidence with `git commit -s -m "test(runtime): record production acceptance"`.

## Plan self-review checklist

- Every approved product decision maps to at least one implementation task and one test.
- Browser, relay, controller, runner, profile publisher, deployment, desktop compatibility, documentation, and production proof all have named files and commands.
- Busy changes are quiesced without cancellation; model and effort remain one atomic per-agent default.
- Runtime truth comes only from signed kind `10100.runtime` plus pinned-controller kind `30181`; kind `30180.model` is legacy-only.
- Owner-only policy covers hosted presentation, runtime, membership, and archive/delete without changing ordinary moderation.
- Catalog normalization explains and removes repeated labels while preserving exact private adapter bindings.
- Restart persistence is controller-owned and tested across browser, controller, and runner restarts.
- No task contains an unresolved marker, placeholder command, secret value, or unspecified production mutation.

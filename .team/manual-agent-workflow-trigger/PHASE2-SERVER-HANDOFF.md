# Phase 2 server execution handoff

This is an implementation/verification record, not a deployment claim. The root session owns full gates, review, commit and rollout. ACP and controller recovery are separately owned slices.

## Server contract

- Kind 46040 accepts strict version-1 agent controls with exactly matching p/h/run/task/grant tags. Capabilities require `runtime_profile: "linux-uids-v1"` and `max_turn_duration_secs` in 1..=604800. Empty legacy capabilities fail closed.
- Every control receipt is committed under the community admission mutex. Claims also lock the run/task, enforce current workflow/owner/agent/channel permissions, exact revision, deadline and single active attempt. Manual attempts share the run-wide ceiling of two and reserve an initial attempt for each other unattempted task. A stale revision returns `reason: "revision_changed", current_revision` without charging.
- HTTP command `message` is `response:<JSON ControlReceipt>` with `{accepted, reason, current_revision, decision, signed_event}`. An accepted claim returns the exact persisted relay-signed 46041 grant; a replay never signs a replacement or allocates another ordinal. An inactive/revoked/stopped grant cannot be revived by replaying its original claim.
- Manual tasks carry destination h, target p, owner actor, workflow/run/step/task IDs, definition hash, `workflow-community`, `workflow-origin=manual`, `workflow-protocol=1`, and the original acceptance deadline. A capable ordinary target receives its own signed task with origin scheduled or event and no artificial 20-minute run deadline. Ordinary grants use the configured ordinary turn limit plus the existing 600-second authentication/startup allowance; they do not consume manual quota or inherit the manual two-attempt ceiling.
- Only manual grants create scoped child credentials; ordinary event/scheduled execution retains its ordinary identity and permissions. The child credential is never materialized as a user or member. It permits bounded HTTP `/query` and `/count` and snapshot-only WebSocket REQ/COUNT of its task channel; membership #p=self is projected to the effective agent for the real CLI's channel-list flow. Metadata uses d, messages use h. The allowlisted read kinds are 1, 7, 9, 30023, 39000–39002, 40002–40003. Every request rechecks credential, attempt, deadline, run and current permissions. All other HTTP endpoints and all WebSocket writes are denied for a recognized child key, including expired/revoked keys. No live subscription survives to require asynchronous credential revocation.
- Started/Finished/Stopped bind exact original agent, instance, task, channel, grant and ordinal. Finished additionally requires an already stored agent-signed kind-9 result carrying exact workflow-result=<original signed task event ID>, origin, run/task/grant/instance/ordinal and h tags. Ingress validates result evidence before storing it. Finished is the supervisor's assertion that its child has already been reaped; it atomically records stopped_at, revokes the credential and aggregates task completion. Dispatch success alone cannot complete a run.
- Only an exact original-grant Stopped receipt receives the narrow HTTP membership-revocation exception. It conveys no other write/read/claim permission. Deadline or permission cancellation revokes child access immediately; unresolved attempts remain stalled until verified stopped. Legacy unknown execution and taskless unresolved rows never age out or become stopped merely because permissions changed.
- Durable outbox delivery retries the same signed task/grant/cancel event IDs. Task claims and attempt acknowledgements stop their relevant retransmissions. Status invalidations are relay signed. Manual result events are excluded from automatic workflow triggering; ACP owns the corresponding conversation-chain exclusion.

## Files owned by server executor

- `migrations/0037_workflow_execution.sql`: control receipts, attempt start/grant evidence, outbox acknowledgement, global child-key uniqueness and ordinary configured turn bounds. Frozen after applying to v3.
- `migrations/0039_workflow_execution_fences.sql`: additive attachment of existing community lifecycle write-fence triggers to all ten new workflow tenant tables. Real relay startup exposed this missing Phase 1/0037 catalog requirement; no gate was disabled and no applied migration was rewritten.
- `crates/buzz-db/src/workflow_execution{,_tests}.rs`: ledger, current read authorization, exact result checks, reconciliation, scheduled task/outbox handling and isolated Postgres regressions.
- `crates/buzz-core/src/workflow_execution.rs`, SDK execution builders: capability contract. Separate recovery executor owns recovery protocol modules.
- `crates/buzz-relay/src/workflow_execution.rs`, `workflow_scoped.rs`, ingress/auth/REQ/COUNT/event/bridge/router/main and workflow sink: control handling, scoped read/write enforcement, lifecycle/outbox workers, actual scheduled dispatch and manual result lineage.
- `crates/buzz-test-client/tests/e2e_workflow_manual_runs.rs`: real HTTP/NIP-42 + built CLI transport fixture against an explicitly configured loopback relay; no provider calls or production channel posts.
- Manual DB evaluator rejects DM destinations consistently for admission and summaries. Private stream channels remain supported.

## Verification to date

Hermit with CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0, CARGO_PROFILE_TEST_DEBUG=0, CARGO_BUILD_JOBS=2 throughout.

- `cargo check -p buzz-db -p buzz-sdk`: PASS, `/tmp/buzz-manual-phase2-db-check.log`.
- `cargo check -p buzz-relay`: PASS after scoped auth/outbox/scheduled integration, `/tmp/buzz-manual-phase2-relay-check.log`.
- `cargo test -p buzz-db workflow_execution -- --ignored --nocapture`: PASS 9/9 on isolated v3, `/tmp/buzz-manual-phase2-db-tests.log`. Covers 100 concurrent distinct claims, durable exact grant replay, active-attempt stopping fence, two total attempts, reservation for second task, exact stored result/reaping, permission revocation, deadline/stalled transition, wrong instance/tenant, strict revision, normal scheduled 7200+600 bound and manual DM rejection.
- `cargo test -p buzz-test-client --test e2e_workflow_manual_runs --no-run`: PASS, `/tmp/buzz-manual-phase2-e2e-compile.log`.
- Actual relay startup correctly rejected missing serving-fence triggers. Migration0039 fixed the catalog; root startup now logs `Community deletion serving fences verified` and listens on isolated loopback55341.
- Initial real HTTP/NIP-42/CLI transport test PASS1/1, `/tmp/buzz-manual-phase2-root-transport.log`; the final fixture additionally checks actual CLI message reads and manual result chain suppression with an ordinary-message positive control.
- Owned Rust files formatted with Hermit rustfmt skip_children=true; `git diff --check` PASS.

## Review cycle 1 compatibility fix and final server checkpoint

`queue_supervised_workflow_tasks` supervises both event and scheduled origins. For a mixed set of targets, each ready target gets one protocol-1 task while each genuine legacy target gets one separately signed legacy task. The sink does not broadcast a duplicate combined task. Known supervised runners with expired capabilities fail closed explicitly. Legacy task delivery is one-shot; its unknown completion remains fenced, and subsequently advertising a capability cannot claim that historical task. Supervised work remains claimable and completable even when legacy work occurs in earlier or later workflow steps. Once ready tasks finish, unresolved legacy tasks leave the run stalled.

Ordinary grants have no manual run deadline, manual quota, manual two-attempt ceiling, or scoped credential. The ordinary per-attempt configured bound remains in force. The event regression exercises three actual grants, signed stored-result validation, and completion. Additional regressions cover mixed targets and mixed steps.

Final executor verification, using the Hermit/lean environment above and isolated `buzz_manual_tests_v3`:

- `cargo test -p buzz-db workflow_execution -- --ignored --nocapture`: **15 passed, 0 failed**, `/tmp/buzz-manual-phase2-review1-db.log`. This supersedes the earlier 9-test checkpoint and includes startup serving fences and both controller-recovery regressions.
- `cargo clippy -p buzz-db -p buzz-relay --all-targets -- -D warnings`: **PASS**, `/tmp/buzz-manual-phase2-review1-clippy.log`.
- Independent review cycle 2: **PASS**, `/tmp/manual-workflow-phase2-review-cycle2.md`.

Server source is frozen and the compiler slot released to root. Root owns the final relay/image rebuild, actual Linux event-trigger fixture, complete repository gates and deployment. Those are separate from these verified DB and lint results; no production deployment is claimed here.

## QA crash-gap recovery amendment

A runner can crash after the relay commits a claim but before saving its returned grant. `RecoverClaim { signed_claim: Event }` (kind 46040, fresh outer envelope) resolves that gap without resubmitting the original claim. Both signatures identify the same agent and old instance; the embedded event must be a strictly tagged Claim for the same community. Its age is deliberately ignored, while normal outer freshness still applies. The original run/task/channel/target must exist in the durable task ledger. Outer tags are the original Claim's p/h/workflow-run/workflow-task scope.

Under the admission mutex, recovery only reads the original receipt. A saved grant returns the exact original signed 46041 even when expired, revoked or already stopped, strictly as evidence for a subsequent original-grant `Stopped(RecoveryStopped)`; the ACP consumer must never spawn from recovery. If no grant exists, recovery returns `accepted=true, reason="no_grant"` with no decision/event. When the original receipt is absent, the same transaction writes a denial tombstone at the original event ID (`claim_recovered_without_grant`) so a delayed original request cannot allocate an attempt. Recovery never refreshes capability or allocates attempts. The narrow revoked-agent HTTP exception checks the same signed claim and persisted task binding; it does not restore membership, reads or execution permission.

This amendment needs no schema migration. The server owns core protocol, SDK tagging, relay strict parsing, DB receipt/tombstone and revoked-agent authorization. ACP separately owns journal persistence and the recovery-only consumer, and QA owns the final real transport proof.

Recovery verification: isolated `cargo test -p buzz-db workflow_execution -- --ignored --nocapture` passed **18/18** (`/tmp/buzz-manual-phase2-recover-db.log`). The added regressions verify exact old signed-grant retrieval after expiration/revocation, replay after stop, no extra attempts, absent-receipt tombstones against 25 concurrent delayed claims, and rejection of forgery, wrong instance, nonexistent tasks and wrong target with zero receipt writes. An initial wrong-target fixture violated its user foreign key; it was corrected to reference an existing different user and the complete suite passed again. Hermit `git diff --check` passed.

- `cargo test -p buzz-relay workflow_execution_control_rejects --lib`: **1 passed**, `/tmp/buzz-manual-phase2-recover-parser.log`. Exercises SDK recovery tags, acceptance of an aged embedded Claim under a fresh outer control, stale outer rejection, and forged original rejection.
- `cargo clippy -p buzz-db -p buzz-relay -p buzz-sdk --all-targets -- -D warnings`: **PASS**, `/tmp/buzz-manual-phase2-recover-clippy.log`. Applied Clippy's equivalent `is_none_or` boolean form in the tag validator before this successful rerun.

Recovery server source is frozen and compiler released. The rebuilt real-relay revoked-agent recovery E2E is separately owned by QA; ACP consumer checks and final rollout remain root's gates.

## QA no-grant liveness amendment

Independent QA reproduced a scheduled/event run with no deadline remaining queued after ACP permanently retired its missing claim. No-grant recovery now also retires known unstarted work under the same admission lock: only a queued protocol-1 task in a queued/running run, with no unstopped attempt for that task, becomes failed. The relay acknowledges its task outbox, reconciles the run and publishes a status invalidation. Previously stopped attempts do not block this retirement. A different live grant for the same task, completed/stalled tasks, legacy tasks, and stalled run evidence are preserved. Existing run-wide failure cancellation for other tasks remains unchanged and still requires stopped evidence before releasing their fences. Cached no-grant receipt recovery applies the same guarded retirement. No attempt allocation or schema migration is introduced.

No-grant liveness verification checkpoint: compilation passed; `cargo clippy -p buzz-db -p buzz-relay --all-targets -- -D warnings` passed (`/tmp/buzz-phase2-no-grant-fix-clippy.log`). The 23-test execution run reached only fixture connection failures (`PoolTimedOut` at pool.connect) while Docker Postgres was unresponsive; no behavior assertions ran (`/tmp/buzz-phase2-no-grant-fix-db.log`). Root assigned QA the DB23 rerun on the fresh isolated native Postgres service at port55451. Server source is frozen and the compiler slot is released. Root owns the final rebuild after that proof.

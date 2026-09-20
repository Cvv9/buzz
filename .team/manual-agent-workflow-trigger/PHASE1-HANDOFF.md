# Phase 1 implementation handoff

No commit, push, production calls, or deployment was performed by this executor.

## Product changes owned by workflow_phase1

- `migrations/0036_workflow_manual_runs.sql`: additive actual-execution run fields, manual request receipts, stable bindings, tasks, attempts, outbox, capabilities, scoped public credentials, admission mutex, schedule collision outcomes, and definition deletion tombstones. Composite tenant keys and deletion inventory remain mandatory.
- `crates/buzz-core/src/{workflow_execution.rs,kind.rs,lib.rs}`: strict version-1 typed operations and canonical kinds 46040–46042. Relay decisions/status are relay-only; execution control is routed through signed command ingestion.
- `crates/buzz-db/src/{workflow_manual.rs,workflow_manual_tests.rs,workflow.rs,lib.rs,deletion.rs,migration.rs}`: atomic manual admission under community/workflow locks with fresh locked authority rows, DB clock, replay receipts, all shared caps, signed task outbox, stable explicit bindings, scheduler collision serialization, truthful unknown/stalled scheduled dispatch records, tombstone retention and schema-manifest guards.
- `crates/buzz-workflow/src/{schema.rs,action_sink.rs,executor.rs}`: explicit immutable `agent_targets`, strict supported manual profile, UTC cron next-occurrence calculation, stable dispatch context. Interval next times remain unknown because durable occurrence buckets differ from the scheduler actual-tick anchor.
- `crates/buzz-relay/src/{workflow_execution.rs,workflow_sink.rs,handlers/command_executor.rs,handlers/ingest.rs,lib.rs}`: replace the former non-atomic unrestricted trigger path with the durable admission path; retain NIP42 token channel restrictions; preserve explicit pubkeys across renames; register actual scheduled tasks atomically with relay events; signed ingress integration regression.
- `crates/buzz-test-client/tests/conformance_multitenant.rs`: update legacy unrestricted manual-trigger expectation for the approved owner/profile restriction while retaining host-confined lookup assertions. The new signed-ingress regression supplies an admitted positive control with test-only capabilities.
- `docs/agent-surface-map.md`, `TESTING.md`: authoritative binding/admission/read boundaries, compatibility restrictions and test commands.

The separate `workflow_phase1_reads` executor owns summary GET, DB read projections, CLI changes and SDK builders; include its files in the combined review.

## Agreements for Phase 2

- `Db::admit_manual_workflow` writes one immutable `ManualDecision` per authorized signed command, including rejections. Accepted run/tasks and relay-signed task outbox intent share the command transaction. It does not publish outbox events or call the ordinary executor.
- `Db::workflow_manual_eligibility` uses the exact admission limit evaluator; HTTP callers first enforce read ownership/channel visibility. `workflow_manual_limits` and `workflow_actual_run` provide projections without inference from dispatch success.
- `ExecutionControl` envelope fields are `version`, `community_id`, `agent_pubkey`, `instance_id`, `operation`. Operations have typed run/task/channel/grant/ordinal fields. SDK builders exist in the companion slice.
- Relay execution control intentionally rejects all capabilities/operations until the isolated runtime and durable claims are implemented. Test fixtures insert capability rows directly into isolated databases; this is not a production readiness path.
- Manual tasks contain `workflow-origin=manual`, `workflow-protocol=1`, `workflow-task`, `workflow-run`, `workflow-step`, `workflow-deadline`, `workflow-definition`, destination `h`, target `p`, and owner `actor` tags. Phase 2 must validate every tag and identity against stored rows before granting execution.
- Scheduled agent dispatch is recorded as `stalled/legacy_execution_unknown` until positive runner stopping/completion evidence exists. Historical `started` schedule claims without linked runs conservatively block manual admission. Phase 2 needs an explicitly trusted, verified old-runner/process-stop recovery path; never clear these by age or fresh capability alone.
- Claims, grants, cancellation/reaping evidence, terminal-state transitions, read-only ephemeral-key authorization, result verification, manual-result lineage suppression, durable runner journals and outbox delivery/recovery remain Phase 2. There is deliberately no production execution unlock in Phase 1.
- Deleting definitions with accepted manual history tombstones/archives them instead of cascading charged/active rows away. All normal update/enable/upsert paths reject resurrection. Existing community deletion fencing/purge policy includes all new tenant tables.
- Supported manual workflows preserve the current executor's same-channel restriction, require static nonempty text, and reject template/manual-input/conditional/other action definitions. One or two explicit `(step, agent)` pairs are supported.

## Verification

All commands use Hermit and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2`.

- `cargo test -p buzz-core -p buzz-sdk -p buzz-workflow -p buzz-db --lib`: PASS, core 260, DB 105 (198 integration tests ignored), SDK 272, workflow 160 (2 integration tests ignored). Includes tenant migration constraint guards and the registered 36-migration manifest. Log `/tmp/buzz-manual-phase1-units-final.log`.
- `cargo test -p buzz-db workflow_manual -- --ignored --nocapture`: PASS 11/11 in fresh `buzz_manual_tests_v2`, with migration 0036 actually applied. Log `/tmp/buzz-manual-phase1-db-v2.log`.
- Initial core/sdk/workflow doctests passed before the additional profile/SDK cases; final gate above verifies current unit source.
- Final reviewed-fix regressions: `cargo test -p buzz-db workflow_manual -- --ignored --nocapture` PASS 12/12 (`/tmp/buzz-manual-phase1-db-final.log`); `cargo test -p buzz-db workflow::tests -- --ignored --nocapture` PASS 8/8 existing scheduler/tenant/approval regressions (`/tmp/buzz-manual-phase1-db-scheduler.log`); `cargo test -p buzz-workflow --lib` PASS 161 with 2 infrastructure tests ignored (`/tmp/buzz-manual-phase1-workflow-final.log`).
- `cargo test -p buzz-relay workflow_sink -- --ignored --nocapture`: PASS 2/2, including signed manual ingress and ordinary scheduled managed-agent dispatch (`/tmp/buzz-manual-phase1-relay-final.log`). The final sequential test command exited 0.
- `git diff --check`: PASS after all executor changes. Owned Rust files formatted with Hermit rustfmt (edition 2021).
- Companion read worker verified SDK workflow 13, CLI workflow 6, summary API 3 and SPA/router 2 focused tests; see `/tmp/manual-workflow-phase1-reads-report.md` for that worker's exact evidence. Root QA still owns repository-wide final gates and compilation of the adjusted ignored multitenant E2E source.

Dedicated infrastructure: `DATABASE_URL=postgres://buzz:buzz_test_only@127.0.0.1:55441/buzz_manual_tests_v2`, `REDIS_URL=redis://127.0.0.1:56441`. The original v1 test database remains intact; v2 was created when explicit NOT NULL was added to a primary-key column to satisfy the migration lint, without altering prior test migration checksums.


### Exact dispatch envelope contract

Manual outbox event is relay-signed kind `46008`, content is the static owner-signed step `text` unchanged, with these single-value tags: `h=<destination UUID>`, `p=<target lowercase hex pubkey>`, `actor=<owner pubkey>`, `buzz:workflow=<workflow UUID>`, `workflow-name=<presentation name>`, `workflow-run=<run UUID>`, `workflow-step=<step ID>`, `workflow-task=<task UUID>`, `workflow-origin=manual`, `workflow-protocol=1`, `workflow-deadline=<absolute Unix seconds>`, and `workflow-definition=<hex definition hash>`. Each `(step, agent)` gets its own signed event/task ID and outbox row. `deadline_at` is DB acceptance time plus exactly twenty minutes. Republishing must use the stored signed JSON and event ID; re-signing changes the identity and defeats replay safety.

Ordinary scheduled dispatch currently keeps its compatible legacy envelope: relay kind `46008`, current step text, destination `h`, resolved `p` targets, owner `actor`, `buzz:workflow`, `workflow-name`, `workflow-run`, `workflow-step`. Explicit target arrays entirely replace name resolution; legacy definitions still resolve unambiguous display-name mentions. `persist_scheduled_workflow_task` writes the event and per-agent task rows atomically, records the original event ID and random task UUIDs, and marks actual state stalled with `legacy_execution_unknown`. A single legacy scheduled event may address multiple agents, hence task event IDs are not globally unique across scheduled task rows. These legacy envelopes do not yet advertise protocol-v1/task IDs; Phase 2 must add supervised scheduled dispatch metadata and completion receipts while preserving the ordinary schedule's action capabilities. Until that is implemented, no scheduled completion is inferred from `workflow_runs.status=completed`.

Control-handler acceptance, outbox publication/reconciliation and the attempt/credential ledger mutations are intentionally not implemented in Phase 1; tables and typed fields are ready, and real runners remain ineligible. This prevents a partially deployed relay from granting unsafe execution.

# Phase 1 independent QA

Date: 2026-09-20. Reviewed approved DESIGN.md Phase 1 acceptance, implementation handoff, final source/diff, and the three review fixes.

## Verdict

**Functional acceptance: PASS. Static gate: FAIL pending one clippy fix.**

`cargo clippy -p buzz-core -p buzz-sdk -p buzz-workflow -p buzz-db -p buzz-relay -p buzz-cli --all-targets -- -D warnings` exits 101:

```text
error: the following explicit lifetimes could be elided: 'a
   --> crates/buzz-db/src/workflow_manual.rs:146:44
146 | pub(crate) async fn evaluate_manual_limits<'a>(
...
152 |     mut reason: Option<&'a str>,
    = note: -D clippy::needless-lifetimes implied by -D warnings
error: could not compile buzz-db (lib) due to 1 previous error
```

Reported immediately to the planner; QA did not modify implementation. Remove the redundant lifetime parameter and use `Option<&str>`, then rerun static analysis. Compilation stopped in the DB crate, so a clean rerun must also check downstream crates.

## Independent command evidence

Commands activated Hermit and used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2`. All Cargo compilations ran serially.

DB commands used both `DATABASE_URL` and `BUZZ_TEST_DATABASE_URL` set to `postgres://buzz:buzz_test_only@127.0.0.1:55441/buzz_manual_tests_v2`, and `REDIS_URL=redis://127.0.0.1:56441`. These are isolated test services. No model-provider requests or production operations occurred.

| Command | Result | Evidence log |
| --- | --- | --- |
| `cargo test -p buzz-core -p buzz-sdk -p buzz-workflow` | PASS: core 260, SDK 272, workflow 161; core doc tests 2 | `/tmp/buzz-manual-qa-core-sdk-workflow.log` |
| `cargo test -p buzz-db workflow_manual -- --ignored --nocapture` | PASS: 14 | `/tmp/buzz-manual-qa-db.log` |
| `cargo test -p buzz-db workflow::tests -- --ignored --nocapture` | PASS: 8 | `/tmp/buzz-manual-qa-db-workflows.log` |
| `cargo test -p buzz-relay workflow_manual -- --ignored --nocapture` | PASS: 1 signed ingress integration | `/tmp/buzz-manual-qa-relay-ingress.log` |
| `cargo test -p buzz-relay workflow --lib` | PASS: 25 | `/tmp/buzz-manual-qa-relay-unit.log` |
| `cargo test -p buzz-relay workflow_send_message -- --ignored --nocapture` | PASS: 1 ordinary scheduled agent dispatch integration | `/tmp/buzz-manual-qa-relay-scheduler.log` |
| `cargo test -p buzz-cli workflow` | PASS: 6 | `/tmp/buzz-manual-qa-cli.log` |
| `cargo fmt --all -- --check` | PASS | `/tmp/buzz-manual-qa-fmt.log` (empty, exit 0) |
| Targeted clippy above | FAIL: redundant lifetime | `/tmp/buzz-manual-qa-clippy.log` |
| `git diff --check` | PASS | exit 0 |

The broad workflow library suite still excludes two infrastructure tests and one example doc test. The relay unit filter reports three ignored integration tests; the two affected manual/ordinary dispatch paths were run explicitly above. Relay fixture deliberately points its pubsub helper at an unavailable local port and exercises the no-publish admission path; this is not proof of live outbox delivery, which belongs to Phase 2.

## Acceptance evidence

- **Atomic admission and quotas:** two separate 100-request tests assert a single workflow start and the shared two-run community ceiling. Additional direct tests enforce one active manual run per target, three accepted runs per workflow, ten per community, failure still charged, exact 24-hour and cooldown boundaries, and no outbox entries for rejections.
- **Replay/crash durability:** original pool-reconstruction coverage did not meet actual process-death acceptance. QA added `workflow_manual_committed_outbox_survives_process_death_and_exact_replay`: a child commits admission and signed task intent, then the parent kills/reaps that exact child before publication. A fresh pool replays the original signed request and verifies identical receipt, one charged run/task/outbox/command event, unchanged valid signed task, and absence of task publication. Only public fixture data is written to a temporary file, removed after use.
- **Rejected exact retries:** QA added `workflow_manual_rejected_request_replays_after_blocker_is_removed`. After a disabled-workflow rejection, enabling the workflow does not change the recorded result for the same request. A fresh signed request succeeds as the positive control.
- **Authority and tenant boundaries:** direct DB tests cover requester mismatch, exact community owner versus admin, current owner/channel intersection, wrong community, stale definition, disabled/profile rejection, and stale capability. Signed ingress also rejects credentials scoped to another channel, a different signer, and real capability advertisement while Phase 1 remains closed.
- **Stable targeting:** persisted explicit target survives rename; display-name-only definitions do not establish discovery. Summary pagination excludes hidden destinations and non-owner/cross-community reads.
- **Scheduler:** concurrent scheduled/manual admission has exactly one winner, writes `skipped_active` when appropriate, retains the deterministic occurrence anchor, and consumes repeat claims. Existing scheduled claim/attachment/tenant tests and ordinary managed-agent dispatch pass.
- **Deletion:** manual charged/active rows survive tombstone deletion and prevent same-ID resurrection and target overlap. Scheduled-only stalled execution and unlinked started claims remain retained after deletion.
- **Review fixes:** scheduled-only deletion retention regression passes; interval next occurrence remains unknown without the actual scheduler anchor; agent summary explicitly excludes raw trace/error fields and future unlisted fields. Browser navigation and summary API selection/cache tests pass.
- **CLI retry:** actual local TCP response-body loss forces retries; all captured signed workflow request bytes remain identical. Receipt parsing and summary cursor/limit validation tests also pass.

## Scope and remaining evidence

QA changed only `crates/buzz-db/src/workflow_manual_tests.rs` (two added regression tests and rustfmt on that new test file) plus this report. No implementation change, commit, push, or deployment.

The full host-mapped multitenant HTTP conformance runtime was not started. Its updated test source requires the planner's compilation/build gate; direct tenant DB and signed shared-ingress checks above cover this phase's affected admission boundary. Summary privacy and SPA selection were verified through focused function/router tests and DB projections, not browser UI execution. Browser UI belongs to Phase 3.

Phase 1 deliberately does not grant attempts or publish manual outbox work. Claims, child isolation/scoped credentials, retry/fallback bounds, cancellation/reaping, result validation, and actual completion require Phase 2 proof before enabling capabilities. Local admission tests do not establish production readiness or a spending bound.

## Planner static-gate closure

Both reported static issues (redundant lifetime and equivalent negated option predicate) were corrected by the executor. Root reran the complete six-crate all-target clippy command with `-D warnings`: PASS (`/tmp/buzz-manual-phase1-root-clippy.log`), workspace formatting and diff checks: PASS. Root built relay and CLI and independently reran all 14 manual DB acceptance tests: PASS. Functional QA plus final static gate is now PASS.

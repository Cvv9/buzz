# Phase 3 independent code review

Decision: **PASS after corrections**, 2026-09-20. Reviewed against the approved DESIGN.md. The existing architect/reviewer agent was reused because the agent thread limit prevented a new reviewer. This report approves the reviewed source; it does not certify execution, publication, or deployment.

## Scope

- Web scheduled-workflow settings, summary/admission DTOs, signing, request lifetime, subscriptions, polling, and profile-edit integration.
- Desktop settings, hooks, policy and DTO adapters, Tauri commands, signed event builders, and associated tests.
- Six-file Buzz CI/release slice documented in `/tmp/buzz-phase3-ci-secret-handoff.md`, plus the three-file optional Sylars read-secret provisioning follow-up in `/tmp/buzz-sylars-readonly`.

## Findings resolved

1. **CI PostgreSQL startup race:** the original socket-based readiness probe could pass against PostgreSQL's temporary initialization server before TCP startup. The wrapper now retries authenticated `SELECT 1` using the same published `DATABASE_URL` as the harness, with a connection timeout. The delayed-TCP reproduction failed before the fix; all six wrapper mock cases passed independently after it.
2. **Web wire-format mismatch:** Rust serializes the unused schedule option as `null`; the original summary parser rejected both real cron and interval shapes. The summary boundary now removes only null cron/interval options before validation. Definition/YAML validation remains strict. Regression coverage includes both serialized shapes and invalid input; the browser fixture now includes the null option. Independent workflow-policy run: **14 passed**.
3. **Desktop unbounded transport:** a stalled response previously left the retained pending guard set indefinitely. `manual_response_with_deadline` now wraps both request sending and complete JSON-body parsing in a 20-second timeout. Failure preserves uncertainty and the original signed envelope for an explicit retry. The added regression uses a real loopback HTTP server that sends headers and an incomplete body. Test execution remains a QA gate.
4. **Desktop eligibility label:** null next-eligible time now displays “Available now” when the row is eligible, and unavailable wording when blocked.

## Boundary review

No remaining actionable findings in the reviewed scope. Owner/relay identity is captured and checked around asynchronous boundaries; native prepared envelopes validate signature, kind, tags, and definition hash. Immediate native rate-limit refusal prevents delayed background submission. Synchronous request guards prevent duplicate preparation; explicit retries retain the same signed event. Reconnect refreshes reads without replaying commands. Query partitions and callback guards isolate identity/community changes. Settings controls remain independent of unsaved profile edits, and result navigation uses validated local references.

Release review confirmed scoped fixture ownership and cleanup, isolated network configuration, normal signed membership authentication, exact hosted candidate digest testing, and integration gates before version promotion. The optional Sylars read credential maps only to its dedicated secret, without substitution of a broad control credential. Independently rerun evidence: six wrapper mock cases, release ordering/registry-status static checks, and **10 Sylars tests passed**.

## Final CI and schema addendum

The additional four-file slice (`.github/workflows/ci.yml`, `schema/schema.sql`, `crates/buzz-db/src/migration.rs`, and test-module relocation in `crates/buzz-core/src/workflow_execution.rs`) is **PASS after one correction**. Frozen source hashes matched during review. The new PostgreSQL 17 job explicitly runs ignored admission/summary/execution modules and the HTTP/WebSocket/CLI test binary from the archived test artifacts, includes the built CLI, verifies authenticated TCP readiness and migrations, and starts a membership-enforced relay on the fixture's required isolated ports. The existing named backend integration gate requires successful new integration and artifact jobs.

Review caught missing pipeline failure propagation in both `nextest | tee` steps: GitHub's unspecified shell could turn failing tests into successful steps. Both steps now explicitly select `shell: bash`. Independent shell reproduction returned 0 without pipefail and the test failure exit code with pipefail; final parsed YAML confirms both steps select Bash. The root session additionally executed each actual extracted step script with a failing cargo stub and observed exit 17 for both. This closes the only finding in the addendum.

Desired-state schema definitions and fences match additive migrations 0036–0039; historical migrations were not edited. The fence guard retains exact equality with the union of the established attachments and migration 0039. Reviewed scratch-database parity evidence reports 113 columns, 73 constraints, 26 indexes and 13 triggers identical across 13 affected tables on PostgreSQL 16. That evidence was supplied by the root session, not independently rerun by this reviewer, and does not replace the PostgreSQL 17 CI gate.

## Remaining execution gates

Final desktop egress-inventory correction: **PASS** on bounded review. The inventory adds the actual workflow publisher's one `/events` reference and one guard call, plus its explicitly test-only injection fixture; no production guard logic or inventory matching logic changed. Boundary 9 is documented. Its regression calls the real private scoped request helper with lower/uppercase valid NIP-49 backup encodings and requires the distinctive key-backup/context error rather than accepting a network failure. Inspection confirms the guard runs before `.send()`. Focused native execution remains owned by the root session.

Final schema-lint correction: **PASS** on bounded independent review. The test-only exception admits exactly the unconditional unique index `workflow_credentials_global_identity ON workflow_run_credentials(ephemeral_pubkey)`, checking table, constraint kind, column list, and complete normalized declaration. It does not exempt the table or other constraints. Regressions reject changed names, columns, tables, partial indexes, and unrelated unique constraints; both migrations and desired-state schema must contain exactly one matching declaration and retain all other scoping checks. Migration 0037 and its cross-community credential uniqueness boundary remain unchanged. Native test execution belongs to the root session's verification gate.

Final desktop lifecycle adjustment: **PASS** on bounded re-review. Scope/generation/request-ref guards now update in `useLayoutEffect`, not during render; cleanup invalidates unfinished preparation before a later commit can dispatch it. A scope-specific memoized store immediately renders empty state for a new identity/community, while closing and reopening within the same scope retains an already-submitted uncertain envelope. Old callbacks can only mutate their detached store and cannot refresh a different scope. The UI countdown derives elapsed time from `query.dataUpdatedAt` without render-time ref writes. This source review does not claim the executor's ongoing 15-case browser run or native rerun has passed.

Final native desktop tests and clippy, web/desktop browser acceptance, repository-wide checks, and the actual rebuilt Linux image/PostgreSQL 17 integration remain separate QA/release gates. Local Docker was unavailable during this review; no Docker builds or Rust compilations were performed. Mock/static results do not substitute for the mandatory integrated-image run. Immutable publication, paired relay/runner rollout, capability verification, seed reconciliation, and live harmless-run verification remain rollout work.

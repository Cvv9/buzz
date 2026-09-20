# Phase 2 independent QA

## Decision

**PASS — Phase 2 protocol and regression QA.** Both recovery defects discovered during QA are corrected and verified. No unresolved functional or authorization finding remains in this scope.

The root session still owns the latest relay/CLI build and repository gates. The latest integrated Linux image and PostgreSQL 17 release checks remain mandatory Phase 3 release gates; this report does not claim deployment or final-image verification.

## Scope and independence

Reviewed the approved DESIGN.md, Phase 2 implementation/handoffs, the prior review findings, and supporting Suite/Sylars changes. Executed targeted tests independently and added meaningful tests only; product fixes remained with the ACP/server implementers. Existing architect agent reused for review/QA because additional agent dispatch hit the thread limit.

## Executed evidence

| Check | Result | Evidence |
| --- | --- | --- |
| ACP workflow execution/recovery suite | **42 passed** | /tmp/buzz-phase2-qa-recovery-acp.log |
| Initial PostgreSQL 17 execution/recovery suite | **18 passed** | /tmp/buzz-phase2-qa-recovery-db.log |
| Actual membership-enforced NIP98 HTTP, CLI and WebSocket E2E | **2 passed** | /tmp/buzz-phase2-qa-recovery-http.log |
| Final-source DB execution/recovery suite on isolated native PostgreSQL 16.13 | **23 passed** | /tmp/buzz-phase2-qa-native-db-final.log |
| Sylars task-read authorization, HTTP/MCP writes denied before effects | **23 passed** | Independently executed `node --test sylars-control/server.test.mjs sylars-control/mcp.test.mjs` in /tmp/buzz-sylars-readonly |
| Whitespace/diff check | **Passed** | `git diff --check` |

ACP command: `cargo test -p buzz-acp workflow_ -- --nocapture`. Coverage includes queued absolute deadline, a wedged fake ACP process reaped at timeout, primary failure selecting Foundry, strict grant binding and two-attempt ceiling, receipt reconnect handling, and the four new grantless-claim recovery cases.

HTTP command: `cargo test -p buzz-test-client --test e2e_workflow_manual_runs -- --ignored --nocapture`, against only loopback port 55341 with relay membership enforcement enabled, isolated PostgreSQL 17 on port 55441, Redis on port 56441, and the built local CLI. Existing CLI/WS scope, denied mutation and manual-result chain suppression checks passed alongside the new recovery test.

Final DB command used the repository Hermit toolchain and explicit `DATABASE_URL=postgres://buzz@127.0.0.1:55451/buzz_manual_native_tests`, with DEBUG=0 profiles: `cargo test -p buzz-db workflow_execution -- --ignored --nocapture`. The final-source binary actually executed was `target/debug/deps/buzz_db-cd192099e5fccafc`; its log records **23 passed, 0 failed**, 2.40 seconds of test execution after compilation.

## Recovery defects reproduced and fixed

1. **DB grant committed before local grant save.** The original ACP characterization proved a valid durable Claim/no-grant journal remained globally stalled without HTTP recovery; the operator journal validator also rejected grantless evidence. The replacement receipt-only RecoverClaim operation uses a fresh outer signature around the exact original signed claim. ACP now retrieves an expired original grant only to report stopped, or terminates locally after an authoritative no-grant tombstone. Transport failures retain the fence and retry; mismatched signed receipts remain rejected. No recovered receipt starts ACP or allocates an attempt.

2. **No-grant ordinary workflow stuck queued indefinitely.** A new real DB regression initially failed with scheduled execution_state=queued after ACP retired the task. Ordinary runs have no manual deadline, so the overlap fence could persist forever. The correction atomically retires only known queued supervised tasks with no live grant and reconciles the run. Final regressions pass for scheduled/event terminal handling, delayed original-claim rejection, competing-claim races, a different live grant, completed tasks, legacy unknown tasks, and previously denied retries after verified stopping. No accepted manual allowance is refunded.

The new HTTP test, `e2e_workflow_recover_claim_after_revocation_is_receipt_only`, proves:
- An original signed Claim older than 90 seconds resolves through a fresh RecoverClaim after relay/channel membership revocation and attempt expiry.
- Recovery returns the exact original signed grant, leaves the attempt count at one, and preserves the stalled lock until the exact original-grant Stopped acknowledgment.
- Unrelated writes, ordinary old-Claim replay, wrong-target recovery and invented task scope receive 403 before recovery receipt writes.
- The exact stopped acknowledgment remains authorized and clears the execution fence.

The aged original Claim is seeded through the real DB control transaction to avoid a two-minute sleep; all recovery and stopped operations travel through actual NIP98 HTTP. Each new recovery fixture uses a unique community hostname explicitly resolved to loopback, avoiding cross-test quota exhaustion.

## Runtime/source integration evidence and limitations

Previously inspected actual native Codex UID 1002 session proof in /tmp/buzz-manual-mcp-session.log: project_intelligence, sylars_control and work_projection all discovered, with zero provider turns. Separate manual configuration retains only server-enforced read credentials; the Sylars read token cannot alias write-capable credentials and has no broad-token fallback.

The root's earlier integrated Linux manual/event run passed in /tmp/buzz-phase2-root-harness-event2.log: primary failure, Foundry second attempt, exact successful result, both process stops, escaped-child cleanup, restart without a third grant, and ordinary event workflow completion. That image predates the subsequent recovery corrections and is not presented as final-image proof.

A later Docker PostgreSQL 17 rerun failed all 23 fixtures during connection setup with PoolTimedOut, before assertions. The isolated native PostgreSQL 16.13 cluster was used for the successful final 23-case rerun; the frozen Docker database and application volumes were not erased or reused for unrelated work. The database-version distinction is intentional and retained in the release gate.

The latest integrated Linux image rebuild was stopped under local disk pressure. By the parent-approved infrastructure exception, latest-image and PostgreSQL 17 verification move to the mandatory Phase 3 release gate. Latest root relay/CLI build remains pending when this report is written; the root ledger records that outcome separately.

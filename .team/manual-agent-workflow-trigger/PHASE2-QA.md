# Phase 2 verification ledger

Protocol review and independent QA passed. This is not a production release claim.

## Final-source verification

- Independent code review cycle2 PASS: `/tmp/manual-workflow-phase2-review-cycle2.md`.
- Independent QA subsequently reproduced and verified fixes for two claim-recovery crash gaps; see `PHASE2-INDEPENDENT-QA.md`.
- ACP workflow/recovery tests42 passed; ACP all-target Clippy passed. Earlier full ACP suite868 library plus10 binary tests passed.
- PostgreSQL17 execution/recovery tests18 passed, followed by final PostgreSQL16.13 tests23 passed after local Docker became unavailable. These include concurrent admission/claims, limits, exact signed evidence, revoked recovery, no-grant tombstones and terminal reconciliation, competing valid grants, and preserved unknown-stop fences.
- Actual membership-enforced relay HTTP/WS/CLI tests2 passed: scoped reads and rejected mutations, manual result chain suppression, original expired grant recovered after access revocation, exact stopped acknowledgment, wrong-target/invented-scope denial. `/tmp/buzz-phase2-qa-recovery-http.log`.
- Root final core/SDK/CLI tests905 plus2 documentation tests passed. The first pass caught a stale workflows command-count assertion; executor updated8 to10 for scheduled/recover and the whole command reran successfully. `/tmp/buzz-phase2-root-final-units2.log`.
- Root latest relay/CLI build, workspace formatting and diff checks passed: `/tmp/buzz-phase2-root-final-build.log`, `/tmp/buzz-phase2-root-final-fmt.log`.
- Root Suite tests198 and configuration validation16services/66values passed; Sylars tests133 passed. Signed companion commits `fd41da1` and `8261aa6`; neither published yet.

## Runtime evidence and limits

- Prior integrated LinuxARM64 actual Rust harness + patched adapter manual/event chain passed, using deterministic local provider fixtures. Exactly two stopped manual attempts, stored successful result, escaped UID1002 helper stopped, identical request replay/container restart caused no third attempt; ordinary event workflow completed with unbounded-by-manual-deadline behavior. `/tmp/buzz-phase2-root-harness-event2.log`.
- Separate LinuxAMD64 runtime-base isolation and adapter wire checks passed. Native Codex under manual UID1002 discovered all3 configured read-only MCP sources with zero provider turns: `/tmp/buzz-manual-mcp-session-final.log`.
- Latest-source local Linux rebuild was stopped for host disk pressure. Only unused regenerable build/incremental caches were reclaimed; application data/volumes retained. Docker then became unresponsive; an isolated native PostgreSQL fixture allowed regression verification without restarting unrelated services.
- These checks do not substitute for final integrated linux/amd64 release images with PostgreSQL17, paired relay/runner deployment, explicit seed bindings, and live harmless brief plus repeated-start rejection. Those remain mandatory Phase3 gates.

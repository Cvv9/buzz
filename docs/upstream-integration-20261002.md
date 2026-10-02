# Buzz upstream integration — 2026-10-02

Local integration branch: `codex/sync-buzz-upstream-20261002`.
Merge parents: existing `63efa8e0e67a4c45fff5bdbe72ac4e6c03df3766` and exact upstream `448407a972ca9da0c1e13d49ee2c2170821be8a2` (34 additional upstream commits). Original `codex/sync-buzz-upstream-20260930` remains at63efa8e. No push, PR, deployment, image build, provider start or migration-helper changes.

## Conflict decisions

Nine files conflicted. ACP combines the upstream optional sole stdin writer and launch prefix with existing workflow isolation, process-group cleanup and effective Pi arguments. Launch wrapping remains inside the workflow privilege boundary. Quiet-host respawn wake replaces polling while retaining per-respawn model/failover and local acknowledgement fields. Mention defaults include both edited messages and workflow tasks. New upstream test fixtures include the additional local runtime fields.

Relay retains the union of both immutable operator rosters and owner fallback, adapting it to the new optional lookup result. Both hosted-runtime and host-bound NIP-FI replay guards remain. Existing S3 conditional-race and safe transport diagnostics files are byte-equivalent to63efa8e.

Starter channels retain bounded fallback IDs and never infer ownership from duplicate rejection. Accepted creates/joins are returned in upstream changed-channel IDs, and immediate reads use writer consistency. AppShell keeps the existing consolidated lifecycle hook and passes the active relay to auto-restart; hooks are not mounted twice. Both workflow publisher and admin mutation egress boundaries remain documented.

Upstream migrations54/55 collide with existing fork numbering, so they are appended as62/63 without changing their SQL. All original1–61 migration files were compared against63efa8e and are byte-identical. Migration structural assertions point to62/63. The new direct-timeout PostgreSQL test runs through63; actual PostgreSQL upgrade remains unrun here.

## Actual validation

All Git/development commands used the Windows toolchain wrapper. Existing caches were reused; no new checkout or worktree. C had2.15GB free initially and about2.19GB during checks. Only three missing small locked TOML crates were downloaded for ACP tests.

- Root and desktop Rust formatting checks: passed.
- Git diff whitespace/conflict-marker checks: passed.
- buzz-db library tests:139passed,426infrastructure tests ignored.
- Relay offline compile check: passed.
- Clippy buzz-acp/buzz-db/buzz-relay, alltargets, warnings denied: passed.
- ACP configuration regressions with documented ambient harness flags cleared:130passed.
- ACP quiet-host recovery:3passed; edit routing:3passed; launch platform guard:2passed.
- Desktop typecheck: passed. Desktop Biome/text/pubkey checks: passed with two existing warnings.
- Desktop defaultNode22 suite:6784passed/34failed initially; captured repeat6785/33. Failures include canvas load-hook errors. Existing bundledNode24.19 was used, compatible with repository Node24.15 pin; isolated canvas27passed.
- Full desktopNode24 suite:6825passed/1failed, a visibility/focus timer expectation. That exact suite passes5tests in isolation. The second jsdom-only command was not reached because first-stage failure short-circuited the script. No assertions weakened.
- Full native Windows ACP suite:1031passed/65failed. Diagnostics include Windows WSL bash shim unable to launch/bin/bash, absent/bin/sh and deliberately unsupported Unix workflow journal locking, plus a WebSocket send deadline assertion. Prefixing Git Bash in PATH did not change native process lookup; repeat preserved same counts. This is not a Linux test pass or proof all failures are platform-only.
- Desktop Tauri offline compile check could not resolve uncached portable-pty; no heavy dependency download attempted.
- `just ci` could not start because no native just executable is available through the required Windows wrapper. Linux ACP/process-group tests, real PostgreSQL tests, mobile tests, desktop Tauri tests and completeCI remain unqualified.

Ignored diagnostic logs are under `target/upstream-20261002-*.log`. Integration is locally reviewable; deployment readiness is not claimed. Existing core974fe and agente229 builds still contain63efa8e, not this merge. The next release step needs compatible Linux/fullCI, real63-migration upgrade checks and newly built/qualified images, coordinated with the fresh Buzz configuration work.

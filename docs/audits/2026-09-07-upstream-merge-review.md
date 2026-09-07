# Buzz upstream merge review — 7 September 2026

The user approved the recommended selective consolidation. The local quality
branch now includes the rebased starter-channel retry and upstream backports
`6e8d078ffe` and `e5a7e26a10`. The retry was adapted to `fetch_channels`, retains
accepted-but-pending IDs, and does not claim ownership after a duplicate
rejection. Seven additional policy tests cover bounded IDs and pending creates;
all 29 channel tests passed before the policy-module extraction. The combined
repository gate is being rerun before merging to main and deployment. The
wholesale upstream/database integration below remains deferred.

Deployment is paused at the user's request pending consolidation and safe-merge review. The preliminary browser image from `54c676ebf3fb3b221807ce7642aeb9ea2a2923c6` built successfully in [run 34108505019](https://github.com/Cvv9/buzz/actions/runs/34108505019), but has not been promoted.

## Exact comparison

- Fork remote main: `5bb766bf6`.
- Current tested quality branch: `54c676ebf3fb3b221807ce7642aeb9ea2a2923c6`.
- Fresh upstream main: `3c7f288c60` (Desktop 0.5.23 release).
- `git rev-list --left-right --count origin/main...upstream/main`: **274 ahead, 280 behind**.
- The upstream side of the common-base diff spans **2,327 files**, with 380,372 insertions and 53,451 deletions. These are diff statistics, not counts of independently reviewed changes.
- A non-mutating `git merge-tree --write-tree HEAD upstream/main` reports **87 conflicting paths**, listed in [the conflict inventory](2026-09-07-upstream-conflicts.txt).
- Every upstream commit was checked separately against the current quality branch using a temporary Git index and `git apply --cached --check`. **53 patches apply; 227 conflict or need prerequisite context.** A clean patch is not a safety verdict or a guarantee that it compiles. [All 280 commits and touched paths](2026-09-07-upstream-commit-inventory.csv) are recorded with heuristic scope labels.

## Findings that block a wholesale merge/deploy

1. **Migration-version collisions.** The trial merged tree contains both fork and upstream SQL at versions 0032, 0033, 0034 and 0035. For example, 0032 would contain both `message_edit_search` and `channel_roster_snapshot_fence`; 0035 would contain both `workflow_run_error_codes` and `relay_operators`. Existing applied migrations cannot simply be renamed or overwritten. Integration needs an explicit compatibility plan based on the deployed migration ledger, with fresh-database and existing-database upgrade/rollback rehearsals.
2. **Destructive migration in the incoming chain.** Upstream adds migrations through 0044. `0044_drop_nip_fi_ledger.sql` drops fifteen identity/authorization ledger tables introduced by 0041/0042. Upstream documents this as a deliberate stateless-identity redesign. Its suitability for this fork must be checked; the presence of DROP statements does not establish that the current production database contains those tables.
3. **Cross-cutting security and runtime conflicts.** Conflicts span relay authorization, ACP queues/configuration, database/runtime code, workflow execution, desktop agent management and release tooling. Taking either side wholesale can discard the fork's owner-only hosted-agent behavior, membership boundaries or deployment customizations.
4. **A browser image is not a relay upgrade.** `Dockerfile.web` deliberately retains the pinned production 0.2.16 relay binary. Merging upstream server code into source does not deliver its server fixes through this image. A server upgrade needs a separately built and verified relay image and migration rehearsal.
5. **The parked local starter-channel retry is not ready unchanged.** `wip/starter-channel-retry-2026-08` contains one unmerged commit marked unverified by its author and conflicts in `channels.rs`. Its retry loop advances to a new channel ID even after an accepted create whose metadata has merely not appeared. That can create additional starter channels during delayed visibility. It needs adaptation to the current `fetch_channels` path and coverage that retries duplicate-blocked IDs without recreating accepted-but-pending channels.

## Candidate integration order

| Candidate | Current evidence | Required gate |
| --- | --- | --- |
| Local browser quality/startup branch | Main is an ancestor; full `just ci`, 155 web unit tests and 112 browser smoke tests passed | Consolidate local work, then rebuild and repeat authenticated production checks |
| `e5a7e26a10`: retain corrupt desktop keyring data until a recovery path exists | Two-file patch applies cleanly; preserves existing identity instead of deleting the only stored copy | Isolated desktop identity tests and native gate; this is separate from browser storage |
| `6e8d078ffe`: camelCase agent-config write payload | Patch applies cleanly; Rust variant fields currently disagree with the TypeScript `envKey` / `configId` / `configKey` contract | Serialization round-trip tests and desktop gate |
| `bb5b9357a7`: TipTap mount-race guard | Patch applies cleanly; narrow client lifecycle fix | Component tests, desktop typecheck and composer interaction |
| `dad5a3386`: Windows packaged frontend path | Valuable packaging fix, but patch needs prerequisites/manual adaptation here | Package tests and a real Windows installer smoke check |
| `6cf514ed9`: wrap message tables | Small UI intent, but the full patch does not apply to this fork unchanged | Adapt renderer and run channel/thread/overflow browser tests |
| `6f6093243`: slow-relay profile/thread recovery | Relevant reliability improvement, but conflicts/prerequisites across ten files | Integrate as a cohesive client transport change with bounded retry/reconnect tests |
| ACP event verification, relay authorization, new operator system, database/identity redesign | Valuable security/runtime work; conflicts and data dependencies prevent a quick safe merge | Dedicated integration branch, isolation/membership tests, migration rehearsal and new runtime image |

The first row passed the full repository gate. The next two were applied together in an isolated detached worktree: 50 identity tests and all three serialization tests passed; native formatting and library Clippy with warnings denied passed. The initial isolated build required the existing native sidecar assets; no product change was needed for that test setup. These are focused candidate checks, not a complete release gate or native end-to-end certification. The remaining rows are review priorities, not approved or deployed changes.

## Consolidation boundary

Before review, Buzz had one registered worktree and three local branches: `main`, `codex/web-startup-quality`, and `wip/starter-channel-retry-2026-08`. Main's local-only commit is already included in the quality branch. Origin has main and the quality branch; there were no stashes. Upstream's many feature branches are not this user's pending work and are not candidates for indiscriminate merging.

The temporary detached validation worktree was removed after the tests; Buzz again has one registered worktree. The separate Suite task confirmed its unmerged Frappe/database maintenance is unrelated to Buzz; those changes should not be swept into this release. Already-merged Suite changes will be retained by refreshing main before image promotion.

Selective backports do not make GitHub's behind counter zero, because they do not establish upstream-main ancestry. The counter reaches zero only after a complete upstream-main merge. That should follow compatibility work, not replace it.

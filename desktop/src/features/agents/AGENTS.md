# Agent configuration contributor rules

Scope: agent config, renderer, access/sharing and profiles.

- Capability facts originate in Rust `KnownAcpRuntime`, exposed through `AcpRuntimeCatalogEntry`, then projected by `lib/agentConfigCore.ts`. No rival TS capability table or harness-ID checks in components. Command-keyed parallelism uses the static definition command and reaches all four catalog constructors; no frontend cap constant.
- Effort uses descriptor `currentPersistence`, not raw env keys; do not equate it with `targetApplication` without the migration. Use named omissions and clearing policies, not behavior/mutation booleans. Async catalog mismatch must not silently erase saved config outside named onboarding cleanup.
- Gate unknown runtime metadata on loading/error states. Keep canonical behavior; use disclosure presets for visibility. Discovery status must remain visible; successful-empty optional-model discovery differs from failure and must not be cached.
- Catalog sharing is relay+owner scoped and relay-confirmed; queued is not published. Shared prompts must be literal and byte-for-byte reviewable: reject prohibited invisible/bidi/control characters at parsing and persistence/import boundaries, never silently strip them.
- Owner-only access applies to all backends. Remote directory ownership must be verified by NIP-OA; owner-only builds admit only same-owner agents. Local cache events must not invalidate the remote directory.
- Profiles show reported/effective data only, no synthetic examples or provenance clutter; unknown rows use an em dash. Owned profile actions/tabs/content are entry-point invariant.
- Hosted model/effort control belongs to the web controller. Desktop shows canonical signed 10100 state read-only; no local `switch_model` or preference publication. Compatibility 30180.model never overrides effective runtime.

## Read the relevant sections before changing behavior

[CONFIGURATION_REFERENCE.md](CONFIGURATION_REFERENCE.md) contains full contracts and tests. Read relevant sections:

| Change | Reference sections |
|---|---|
| Runtime metadata/config core/persistence/rendering/discovery | The one rule; Rules 1–6 and 8 |
| Onboarding, defaults, create/edit/Advanced behavior | Rules 7–9 |
| Sharing, access warning, run location, instance access saves, owner-only policy | Rules 10–12 and 15 |
| Profile data/presentation/navigation or hosted runtime | Rules 13–15 |
| Any changed behavior | The tests that enforce this: select the applicable named tests |

Onboarding/shared-renderer changes require `desktop/tests/e2e/onboarding-agent-defaults.spec.ts`: setup detects readiness, defaults chooses config, Back/Skip write nothing, only valid Next persists and advances after success. Access changes retain anyone/allowlist consequence warnings, actual run-location copy (unknown means local; never invent remote execution), and exact-instance `update_managed_agent` saves.

Update this entrypoint and reference rules with behavior changes in the same PR, or state “no rules changed.”

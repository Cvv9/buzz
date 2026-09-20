# Phase 3 QA and release ledger

This ledger separates local checks, CI, image publication, deployment and live
execution. A pass in one category does not establish another.

## Local evidence

- Web policy/unit suite: 163 passed after real nullable-schedule DTO correction.
- Web production build, TypeScript, owned-file Biome and size/public-key guards:
  passed. Final focused browser suite: 12 passed; full web smoke: 124 passed. Includes same-event retry,
  duplicate clicks, two-client admission fixture, failed summary hiding,
  identity changes during signing, offline/reconnect, focus, status invalidation,
  visible polling and unsaved agent-name independence.
- Desktop Node suite: 5068 passed. TypeScript, production build and full desktop
  check passed. Final focused native workflow tests: 25 passed, including timeout
  and no-queue regressions. Final native all-target Clippy passed after the
  test fixture explicitly checked its read amount.
- Desktop focused browser suite: 15 passed, including actual outcome display,
  duplicate click/retry, loading/error/empty, pagination, offline, reconnect,
  closing/identity change during signing, polling and valid result navigation.
  Direct community-switch and focus-only cases passed; four lifecycle cases
  passed again against the final rebuilt source after dependency cleanup.
- Root inspected the cropped web and desktop settings screenshots. The controls
  expose the applicable limits before admission and distinguish queued from
  completed state. Screenshots use synthetic workflow data.
- React Doctor was rerun after new files were added to the diff inventory.
  Web findings are minor formatter/ref-initialization costs, component complexity,
  and a deliberate live-subscription state reset; no demonstrated correctness
  defect. Desktop render-time ref writes were moved to the commit lifecycle;
  final React Doctor scan reports zero errors and one existing complexity warning.
  No new dependency or unrelated refactoring was introduced.
- CI wrapper: six mocked cases pass, including socket-ready/TCP-not-ready
  PostgreSQL startup regression. Release ordering/registry-status checks pass.

## Infrastructure and full-suite gate

Local Docker remains unresponsive to a bounded ten-second `docker info`, so the
final Linux image/PostgreSQL17 gate must run on CI. The previous Phase2 native
PG16 and earlier PG17/image evidence are retained in their ledgers.

Full `just ci` exposed macOS27's SQLx proc-macro LINKEDIT alignment failure.
Targeted cache rebuilding did not fix it. A temporary external RUSTC_WRAPPER
adds `-C strip=none` only to proc-macro compilation and allows the checks to
proceed; it changes no repository source or assertions. The resumed check then
found `items_after_test_module` in workflow_execution.rs, fixed by moving the
unchanged test module to EOF. The updated schema/fence parity unit test passed;
repository-wide checks are running again.
Reference: https://github.com/rust-lang/rust/issues/157750

## Supporting deployed dependency

Sylars PR45 deployed read-only token support; PR46 preserves that token in
manual deployment/Key Vault sync. Both merged, with real Azure deployment
steps succeeding (runs35483382009 and35484164379). The dedicated token is stored
in the existing Azure vault and AWS secret. Targeted restart, internal and public
TLS probes return task-read200 and write403; no task was created. Remote deploy
lock was released and the temporary AWS SSH inspection firewall was restored.

## Remaining gates

Full desktop smoke and remaining local checks where available, explicit
ignored DB and authenticated HTTP/WS/CLI tests on CI, exact Linux image/PG17
integration, reviewed Buzz/Suite PRs, immutable paired image publication and
rollout, seed reconciliation, and a harmless real manual workflow followed by a
repeat rejection. The new manual-run feature is not deployed yet.

## Full-suite correction

The first completed local pass passed formatting/lint across Rust, desktop, web
and mobile, plus eight Rust test groups. The database group failed its generic
community-first uniqueness guard on the intentional global ephemeral identity
index. The correction is test-only, exact to that named unconditional index, and
requires its presence in both schema and migrations. Independent review passed;
all other tenant-key checks remain unchanged. Corrected verification follows.

The corrected full gate passed all nine fallback Rust test groups, all5068
desktop unit tests, desktop production build/native typecheck, and2548 native
tests (17 intentionally ignored). Its sole remaining failure was the explicit
egress inventory: the new workflow publisher already called the guard, but its
1URL/1guard row was absent. The final correction adds that exact inventory row,
boundary documentation, and a real publisher injection regression for both
valid NIP49 encodings. Production guard logic is unchanged. Independent review
passed. Focused native follow-up and remaining web/mobile targets are running;
already-passing unaffected checks are retained instead of repeating them.

Final web production build and all1465 mobile tests passed. The new real
workflow publisher injection test passed for lower/uppercase valid NIP49
fixtures. Its fixture file also required the existing exact NIP49 handling
allowlist entry; no production file was exempted. Static scanner reproduction
passed all352 source files and mutation checks. Final compiled egress tests16
and publisher regression1 passed. Remaining native targets/lint follow below.

## Final local gate outcome

All required local check/build/test steps are now covered by passing evidence.
The full `just ci` invocation exposed and stopped at the two explicit inventory
findings documented above; it is not reported as one uninterrupted green run.
After correction, all11 migration regressions, all16 egress tests, the real
publisher injection test, remaining terminal/native binary/integration/doc
targets, native all-target Clippy and formatting passed. Final remaining web
build/mobile test command exited0; mobile1465passed. Local Docker-backed
`just test` remains unavailable, so CI's explicit PG17/database/transport and
exact Linux image gates remain mandatory before merge/release. No affected
product source changed after the passing browser/build evidence.

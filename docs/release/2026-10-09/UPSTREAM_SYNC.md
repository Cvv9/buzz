# Local upstream integration candidate — 9 October 2026

This integrates upstream `e9269cbdf66b0e2fdb588aa20aad65bcba3ca622`
onto fork `25f71566a0201c4465a20476a331a5ed8601155e` on the local branch
`codex/upstream-parity-20261009`. The comparison was 335 commits ahead and
52 behind. Main and production are not changed by preparing this candidate.

## Integration decisions

- Resolve all 19 conflicting files while retaining the dedicated private admin
  listener, configured-origin checks, hosted runtime boundaries and local agent
  keyring modules. Add upstream admin reads and the optional read-state API.
- Introduce upstream personal read-state migrations as **0064 and 0065**.
  Existing migrations 0001–0063 retain their identities and contents.
- Retain the fork's monolithic desired-state schema and its custom workflow
  tables/fences. Add personal read-state DDL and enforce schema/migration parity.
  Defer upstream's schema fan-out and its layout-only test as one structural
  change; do not leave an alternate, incomplete split schema beside the fork.
- Retain the fork's CI selection and optional native-app policy. Defer upstream
  desktop/relay CI restructuring rather than mix incompatible job/gate layouts.
- Port custom manual-workflow reads, execution and recovery to upstream's
  admitted transaction API. Keep community admission and durable retry state.
- Preserve manual quota/history and unresolved execution when integrating
  upstream coordinate-based workflow deletion. Its production-path regression
  uses the new coordinate deletion entrypoint rather than a test-only helper.
- Adopt incoming client/pairing/agent/push/database fixes and bundled Silo
  configuration. This changes source/development configuration, not the live
  object store or any production deployment.

## Qualification boundary

Source compilation, TypeScript, formatting and unit evidence are recorded in
the accompanying local assessment. They do not establish database upgrade,
relay integration, native UI, mobile device or production recovery success.
The full `just ci` gate is unavailable in this Windows environment because
`just` is not installed; infrastructure-backed tests also need isolated
Postgres and Redis. Those gates and human workflow confirmation remain before
merging into main or publishing. No push or deployment is part of this change.

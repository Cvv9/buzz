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

PR [#91](https://github.com/Cvv9/buzz/pull/91) now tracks this candidate. The
VarVik validation scope is the existing web app and affected server services;
native desktop/mobile checks remain disabled. Browser and server evidence do
not establish native UI or mobile device behavior.

### CI repairs — 10 October 2026

The message-edit indexing method now validates timestamps before writes and
uses one community-admitted transaction for both derived content and mentions.
The desired-state schema includes the nullable edit columns and generated
search expression already supplied by migration 0032; existing migrations are
unchanged. Nine targeted PostgreSQL 16 tests passed against an isolated local
database, including injected mention failures, search rollback, empty mentions,
invalid timestamps and community quiescing. PostgreSQL 17 and relay integration
qualification remain separate GitHub CI gates.

CI service and BuildKit pulls use Google's Docker Hub mirror. A CI-only Compose
overlay retains the existing service versions and pinned Silo image digests.
Helm dependency repository metadata changes to the mirror while preserving
Postgres 0.19.5 and Redis 0.30.3; their manifests and archive hashes were checked
against the original registry. Dependency build, lint and all four render
fixtures passed. These transport changes do not waive build or runtime gates.

The broader GitHub run on `6ac1ec71e` passed Rust unit tests, web/admin-web,
Linux container builds, Helm, mesh lifecycle, relay E2E and manual-workflow
integration on PostgreSQL 17. The PostgreSQL lane passed 966 of 967 tests,
exposing a retained-ledger deletion reporting defect: concurrent retries both
reported a change because an archived workflow row remained present.

Workflow deletion now reports actual affected rows and does not rewrite an
existing tombstone on retry. The physical-deletion fixture completes its
non-manual run; separate retention coverage preserves pending runs and schedule
claims, verifies a single concurrent winner, and checks stable retry timestamps.
All six deletion tests passed on isolated PostgreSQL 16. Independent review
found no blocker. These results do not qualify the revised head: fresh server,
PostgreSQL and relay CI remain required before merge.

# Buzz contributor entrypoint

For non-trivial planning/review, read [VISION.md](VISION.md), relevant `VISION_*.md`, [TESTING.md](TESTING.md), and affected package-local `TESTING.md`. Check product intent and call out intentional tensions. Scale validation to risk; exercise user-visible/integration workflows when practical. CI and runtime evidence are separate.

## Commands and gates

- Before Git/hooks and development commands, activate Hermit: `. ./bin/activate-hermit` (Unix). In PowerShell use `./scripts/with-toolchain.ps1 <command...>`; never execute/dot-source the extensionless Unix activation file or rewrite hooks to compensate for PATH.
- Setup: copy `.env.example` to `.env`, configure it, then `just setup`; `just relay` starts `ws://localhost:3000`.
- Run `just ci` before every PR (format, lint, static checks, Rust/Tauri/desktop/mobile tests, desktop/web builds). Clippy does not replace fmt. `just test-unit` needs no infrastructure; relay/db/auth changes also require `just test` with Postgres + Redis.
- Root Cargo excludes desktop: run `cargo test --manifest-path desktop/src-tauri/Cargo.toml` explicitly. Set the workdir on each command; shell CWD does not persist between tool calls.
- Hooks auto-fix/re-stage formatting; `just fix-all` fixes formatting, `just hooks` reinstalls hooks. Commit with `git commit -s`; rebase/cherry-pick need `--signoff`. History rewrites/force-push need explicit authorization. This workspace restricts buzz to local work; do not push.
- No `unsafe`; no new production `unwrap()`/`expect()`; use `?` and proper errors. Document new public APIs.

## Protocol invariants

- Prefer Nostr events over feature-specific HTTP JSON APIs. Preserve the host-derived community boundary on every HTTP path; reserve HTTP for the documented HTTP-only surfaces and generic event/query/count bridges.
- Register kinds in `crates/buzz-core/src/kind.rs` first. Channel events use `h`, not `e`; addressable channel metadata/membership use `d` (39000/39001/39002). Metadata is kind 39000, not 41; `get_channels` resolves membership from kind 39002's `d` tag.
- Raw relay queries require explicit `kinds` (otherwise p-gate 403). CLI `messages search` chooses its own supported kinds and has no `--kinds` option. CLI `--format compact` precedes the subcommand.
- Add agent-facing operations to `buzz-cli` first, then wire `client.rs`; `buzz-dev-mcp` is separate. Keep workflow evalexpr conditions simple/tested. Reply insertion must update root `reply_count` and `descendant_count`.

## Read by task

Only load the relevant reference/section; these are not a blanket reading list.

| Task | Required guidance |
|---|---|
| Architecture, crate ownership, new protocol/API/CLI behavior or CLI deep links | [Architecture reference](docs/contributor/architecture.md); [CONTRIBUTING.md](CONTRIBUTING.md) for setup/style/add-feature procedures; [ARCHITECTURE.md](ARCHITECTURE.md) for design |
| Agent name/avatar/model/access/membership/mentions/history changes | [Agent surface map](docs/agent-surface-map.md); update it when routes, sources of truth, consumers or invalidation boundaries change |
| Setup/hooks, tests, desktop E2E or screenshots | [Validation reference](docs/contributor/validation.md); CLI live tests: [CLI testing](crates/buzz-cli/TESTING.md) |
| Desktop UI, performance, typography, community caches | [Desktop reference](docs/contributor/desktop.md) and architecture reference's Common Gotchas |
| Agent configuration, sharing/access/profile or hosted runtime UI | [Agent configuration entrypoint](desktop/src/features/agents/AGENTS.md) |
| Flutter changes or runtime validation | [Mobile reference](docs/contributor/mobile.md) |
| Release/build ecosystem | [RELEASING.md](RELEASING.md), architecture reference's Ecosystem |

Desktop: use named rem text tokens (`text-base` for chat body/author; `text-2xs`/`text-3xs` for meta); no arbitrary px/rem/em text sizes. Register community-scoped singleton resets in `resetCommunityState()` in the same change.

E2E: use `pnpm test:e2e:smoke`/`pnpm test:e2e:integration` in desktop, or `pnpm build:e2e`, never a plain build for mock bridge tests. Follow the validation reference for init/subscription/animation sequencing. PR screenshots must use `scripts/post-screenshots.sh`, never relay media/`buzz upload`/third-party hosts; validate hand-edited Markdown with `scripts/check-pr-image-urls.sh`. Publication still requires authorization.

Mobile: no `StatefulWidget` or `print()`; use Riverpod/Hooks and logging. No cross-feature imports; keep one public widget/file, split at the 1000-line ceiling without overrides. Reuse runtime/build caches; no `flutter upgrade` absent a toolchain task. Report actual device/community/workflow evidence.

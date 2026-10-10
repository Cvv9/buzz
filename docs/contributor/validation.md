# Buzz Validation Reference

Read only for the task routed here by [AGENTS.md](../../AGENTS.md). Commands and code paths below are relative to the repository root unless a command changes directory.

VarVik's default product is the existing web app. Follow the hard product-scope rule in [AGENTS.md](../../AGENTS.md#product-scope--hard-rule): select web and affected server checks; do not run desktop/Tauri/mobile checks or broad `just ci`/`just setup` commands unless native work was explicitly requested. Native procedures below are conditional reference material, not default steps.

## Getting Started

```bash
. ./bin/activate-hermit   # activate hermit toolchain (Rust, Node, etc.)
cp .env.example .env      # configure local environment
just setup                # install deps, run migrations
just relay                # start relay at ws://localhost:3000
# Select web + affected server checks; see the product-scope rule above.
```

On Windows, the default agent shell is PowerShell. Do **not** dot-source or
execute the extensionless `bin/activate-hermit` file from PowerShell: Windows
will open an interactive "Select an app" dialog. Run commands through the
PowerShell wrapper instead:

```powershell
./scripts/with-toolchain.ps1 cargo test
./scripts/with-toolchain.ps1 pnpm --dir web test:unit
```

The wrapper uses the installed native Rust/Node tools and keeps all activation
inside the background PowerShell process.

See CONTRIBUTING.md for full setup details and dependency requirements.

### Agent changes are cross-surface changes

Before changing an agent name, avatar, model, access rule, channel membership,
mention behavior, or historical message presentation, read
[`docs/agent-surface-map.md`](../../docs/agent-surface-map.md). It inventories the
relay events, precedence rules, write paths, caches, desktop/web routes, UI
consumers, and required tests. Update the map in the same change when a route,
source of truth, consumer, or invalidation boundary changes.

---

## Quality Gates

Run `just ci` before every PR — it runs repository-wide formatting, lint,
and static checks; Rust, Tauri, desktop, and mobile tests; and desktop and web
builds. Clippy passing does not mean fmt passes; run both.

Run `just test` for integration tests if you touched `buzz-relay`,
`buzz-db`, or `buzz-auth` — these require a running Postgres and Redis.

**Pre-commit hooks** are installed automatically by `just setup` and auto-fix
formatting via `stage_fixed`. Pre-commit runs fix variants in parallel (Rust
fmt, Tauri Rust fmt, desktop biome fix, web biome fix, mobile dart format).
Auto-fixable issues are fixed and re-staged; unfixable lint issues block the
commit. **Pre-push hooks** run clippy (workspace + Tauri), desktop TypeScript
typechecking (`tsc --noEmit`), and fast unit tests in parallel (Rust, desktop
JS, Tauri Rust, mobile Flutter) — no overlap with pre-commit. Builds are
CI-only. Run `just fix-all` to auto-fix all formatting in one shot. Run
`just ci` for the full local gate. Run `just hooks` to
re-install hooks after env changes. Before agents run Git or hooks, activate the
repo's Hermit environment (`. ./bin/activate-hermit` on Unix, or
`./scripts/with-toolchain.ps1 <command...>` on Windows); do not invoke the Unix
activation file directly from PowerShell and do not rewrite hook commands to
compensate for an unconfigured shell `PATH`.

**Commit with `git commit -s`.** The required **DCO Check** fails any PR with a commit missing a `Signed-off-by` trailer, and `just hooks` installs a `commit-msg` hook that adds it to commits you create locally (`git rebase` and `git cherry-pick` still need `--signoff`) — if you build commit commands programmatically, include `-s` every time. Repairing unsigned history requires explicit authorization for the rebase and force-push; verify the actual base branch before using `git rebase --signoff <base>`. Workspace publication restrictions still apply.

Additional rules:
- No `unsafe` code
- Do not introduce new `unwrap()` or `expect()` in production paths — use `?` and proper error types
- New public API must have doc comments

---

## Testing

```bash
just test-unit    # unit tests, no infrastructure needed
just test         # full integration suite (requires Postgres + Redis)
```

E2E tests live in `crates/buzz-test-client/tests/`:
- `e2e_relay.rs` — WebSocket relay protocol
- `e2e_media.rs` — media upload/download (Blossom)
- `e2e_media_extended.rs` — extended media scenarios
- `e2e_nostr_interop.rs` — Nostr interop (NIP-50 search, NIP-10 threads, NIP-17 gift wraps)

Desktop E2E: `cd desktop && pnpm test:e2e:smoke` for mock-bridge smoke
coverage, or `pnpm test:e2e:integration` for relay-backed coverage. These
scripts build the required E2E bridge before running Playwright.

See [TESTING.md](../../TESTING.md) for the full multi-agent E2E guide.

### PR Screenshots

> **Do NOT use `buzz upload`, the relay media endpoint, or any third-party
> image host for PR screenshots.** Relay media URLs fail through GitHub's camo
> proxy. Always use `scripts/post-screenshots.sh` for PNGs before linking them
> from a PR body/comment. If you hand-edit PR markdown, run
> `scripts/check-pr-image-urls.sh <markdown-file>` first to catch relay URLs.

For mobile simulator screenshots, save the PNGs in a local directory and run
`./scripts/post-screenshots.sh <PR-number> <png-dir>` or use the third argument
with a markdown template containing `{{filename}}` placeholders.

The desktop app requires the E2E mock bridge to render — it cannot run in a plain
browser. Use `just desktop-screenshot` to capture screenshots (builds frontend,
starts preview server, runs Playwright automatically):

```bash
just desktop-screenshot --name home
just desktop-screenshot --name channel --route /channels/general
just desktop-screenshot --name search --click open-search
just desktop-screenshot --name settings --click open-settings
```

Options: `--name` (filename), `--route` (client route), `--active-channel`
(channel to view), `--click` (left-click data-testid or CSS selector),
`--right-click` (right-click for context menus), `--hover` (hover before
capture), `--clip` (crop region as `x,y,w,h` — e.g. `0,0,256,720` for sidebar
only), `--wait` (ms, default 2000), `--viewport` (WxH, default 1280x720),
`--outdir` (default `test-results/screenshots`), `--messages` (JSON file path).
Output is a PNG path on stdout.

Use `--messages` to inject content into a channel before capture. The JSON file
is an array of objects — `channelName` and `content` are required, all other
fields are optional and passed through to `__BUZZ_E2E_EMIT_MOCK_MESSAGE__`:

```json
[
  {
    "channelName": "random",
    "content": "Hey @tyler check this out",
    "pubkey": "953d...",
    "kind": 40002,
    "mentionPubkeys": ["deadbeef..."],
    "extraTags": [["broadcast", "1"], ["e", "some-root-id"]],
    "parentEventId": "abc123"
  }
]
```

Without `--active-channel`, all messages must target the same channel and the
helper navigates to that channel (useful for showing message content). With
`--active-channel`, messages can target multiple channels while the "camera"
stays on the specified channel (useful for unread indicators, badges, etc.).

```bash
# Messages in the channel you're viewing (code blocks, formatting, etc.)
just desktop-screenshot --name code-blocks --messages /tmp/msgs.json

# Messages in OTHER channels to trigger unread state
just desktop-screenshot --name unread-dot \
  --active-channel general --messages /tmp/badge-msgs.json

# Cropped to sidebar only (256px wide)
just desktop-screenshot --name sidebar-unread \
  --active-channel general --messages /tmp/badge-msgs.json \
  --clip 0,0,256,720

# Context menu on an unread channel (wider crop to include popup)
just desktop-screenshot --name ctx-mark-read \
  --active-channel general --messages /tmp/badge-msgs.json \
  --right-click channel-random --clip 0,200,320,300

# Hover state (e.g. copy button reveal)
just desktop-screenshot --name copy-hover \
  --messages /tmp/code-msgs.json --hover "[data-testid='copy-code']"
```

Available mock channels: `general`, `random`, `design`, `sales`, `engineering`,
`agents`, `watercooler`, `announcements`, `alice-tyler`, `bob-tyler`.

`scripts/post-screenshots.sh` hosts PNGs on a per-developer branch
(`agent-screenshots/<github-username>`) and posts a PR comment with
commit-SHA-based image URLs (immutable — safe from later overwrites):

```bash
./scripts/post-screenshots.sh 803 test-results/screenshots
./scripts/post-screenshots.sh 803 test-results/screenshots body.md  # custom body prepended
```

The body file supports `{{filename}}` placeholders (without `.png`) to inline
images at specific positions. Images not referenced by any placeholder are
appended at the end. Without placeholders, all images are appended (backward
compatible).

```markdown
### Unread dot
A message arrives in `#random`.

{{01-unread-dot}}

### Context menu
Right-click shows "Mark as read".

{{02-context-menu}}
```

Re-runs overwrite the image blobs on the `agent-screenshots/<username>`
branch, but the script **appends a new PR comment** — it does not edit or
delete the previous one. After reposting, delete the superseded comment so
only the current set remains, otherwise reviewers still see the stale images:

```bash
# List screenshot comments to find the stale one's id
gh pr view <pr> --repo block/buzz --json comments \
  --jq '.comments[] | select(.body | test("pr-<pr>--")) | {id, url}'
gh api -X DELETE repos/block/buzz/issues/comments/<stale-comment-id>
```

Branch cleanup when fully done: `git push origin --delete agent-screenshots/<username>`.

### Writing E2E Screenshot Specs

When screenshots need seeded state, live messages, or UI interaction before
capture, write a Playwright spec instead of using `just desktop-screenshot`.
Add specs to `desktop/tests/e2e/` and register them in `playwright.config.ts`
(`smoke` project `testMatch`). Every test calls `installMockBridge(page)` for
mock Tauri IPC. Mock pubkey, channel names, and UUIDs live in `e2eBridge.ts`.

**Always build with `pnpm build:e2e`, never `pnpm run build`.** The mock Tauri
bridge is compiled in only for `--mode e2e` (see `installE2eBridgeIfConfigured`
in `desktop/src/main.tsx`). A plain `pnpm run build` strips it, so
`window.__TAURI_INTERNALS__` is never defined and **every** mock-mode spec fails
with `Cannot read properties of undefined (reading 'invoke')` — the app renders
"Community connection failed" instead of the UI under test. That looks exactly
like a product bug rather than a build mistake, so it burns real time.
`pnpm test:e2e:smoke` and `pnpm test:e2e:integration` run the right build for
you; prefer them over a manual build plus `playwright test`.

**Stale server:** `reuseExistingServer: true` means a previous build's server
serves old code. Kill port 4173 and re-run `pnpm build:e2e` before re-running
tests after code changes.

**`addInitScript` before bridge:** `page.addInitScript` (localStorage seeding)
must run BEFORE `installMockBridge(page)` — React reads state on mount, the
bridge triggers mount.

**Live messages:** Call `waitForMockLiveSubscription(page, channelName)` before
`__BUZZ_E2E_EMIT_MOCK_MESSAGE__` — messages are silently dropped without a
subscription. Navigate to the channel first (triggers subscription), then away
(so unread indicators appear), then inject.

**Animation timing:** Radix components animate in via CSS. `toBeVisible()`
resolves mid-animation — wait for completion before screenshotting. Use the
shared helper (mandatory before any `page.screenshot()` or
`locator.screenshot()` in specs):

```ts
import { waitForAnimations } from "../helpers/animations";

// ... after the element is visible but before capturing:
await waitForAnimations(page);
await page.screenshot({ path: "...", clip: { ... } });
```

The `just desktop-screenshot` path (`screenshot.mjs`) calls
`waitForAnimations` automatically — no manual step needed there.

For per-element waits (rare — prefer the page-level helper above):

```ts
await menuItem.evaluate((el) =>
  Promise.all(
    el.closest("[data-state]")?.getAnimations().map((a) => a.finished) ?? [],
  ),
);
```

**Cropping:** Use `clip` — full-window (1280x720) screenshots are unreadable
for sidebar features. Sidebar = 256px; context menus ~450px.

**Distinct states — verify before posting:** when one view renders many
elements at once (e.g. all team cards in a single grid), an unscoped
full-page `page.screenshot()` captures the *same* pixels for every shot, so
multiple PNGs come out byte-identical. Scope each shot to its subject with
`locator.screenshot()` (full-page `clip` only when an overlay like an open
dropdown must be included). Then gate on hash distinctness before posting:

```bash
shasum -a 256 test-results/<dir>/*.png   # every hash must be unique
```

Identical hashes mean two shots captured the same state — fix the spec, do
not post. This catches the most common screenshot regression.

**`general` has pre-seeded messages** making `hasUnread` always true. Use
`engineering` for "muted + no unread" visual states.

**PR comments:** Use a body template (3rd arg to `post-screenshots.sh`) with
`{{filename}}` placeholders. Each screenshot gets a `###` heading + one-line
description. See [PR #803](https://github.com/block/buzz/pull/803).

---

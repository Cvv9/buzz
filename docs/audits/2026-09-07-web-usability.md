# Web usability audit — 7 September 2026

Scope: live `https://buzz.varvikstudios.com/` in the existing Chrome session, desktop and 390 × 844 viewport; source review and local regression tests. All eight initial issue groups below are fixed and deployed. Production verification caught an additional relay-admission regression; the first release was rolled back, then the corrected release was deployed and verified. No production messages, invitations, agent permissions, or credentials were changed.

## Latest outcome

The confirmed fixes are deployed at web revision
`b41a44b7b2ba4b95550d150a095c112f4b603dbd`. Production is healthy on registry
digest `sha256:ef0fe23041f1feffecdcb65998ebe32e5b2cbce914e62fd2bc5629fbf8bb06e1`.
The served entry is `/assets/index-CB2IrDk2.js`. The full repository CI gate and
all 43 browser smoke tests passed; later web-only adjustments passed fresh web
checks/build and the complete browser suite.

| Final live check | Observed result |
|---|---|
| Saved sign-in after deployment and reload | Restored without recovery-key or password re-entry |
| Startup transport | 1 WebSocket, 1 authentication |
| Startup REQs in an 8-second complete trace | 47, down from 87 before the follow-up batch |
| Profile REQs | 4, down from 38 |
| Relay throttle rejections | 0 in the final captured run |
| Cache-disabled composer readiness | 1.36 seconds |
| Warm reload composer readiness | 1.18 seconds |
| First contentful paint / document load | 464 ms / 353 ms in the cache-disabled run |
| Startup scripts | 989,771 decoded bytes; 332,583 transferred bytes |
| Inbox secondary-text contrast on the user's theme | 13.22:1, up from 3.20–3.82:1 |
| Phone New agent / Edit profile target height | 44 px / 44 px |
| Dialog Escape and focus return | Passed live; focus returns to New agent |

The final startup correction also waits for the first channel roster before
loading custom emoji and batches list/set reconnect notifications. Neither
profile nor emoji batching changes authoritative event precedence or skips
reconnect refreshes. Measurements are single-session lab observations, not
field percentiles or a promise for every device/network.

**Bounded reassessment: 16/20**, up from 13/20. Accessibility, performance,
responsive design, and theming are each 3/4; implementation integrity is 4/4.
The confirmed implementation defects in this batch are fixed, but the strict
full-mark evidence matrix below still needs screen-reader and reduced-motion
workflow checks, real phone/keyboard coverage, all supported custom-theme
states, and repeated constrained-network/two-tab startup measurements. Those
unverified conditions do not earn automatic passes. This is not a 20/20 or
whole-product accessibility certification.

Release: https://github.com/Cvv9/buzz/actions/runs/34092456507

## Confirmed findings

| ID | Priority | Evidence and impact | Fix |
|---|---|---|---|
| WEB-01 | P1 | Identity restore catches storage errors and renders import/setup with a null summary. A read failure is indistinguishable from no account. | Explicit recoverable storage error, retry, bounded database open, preserve password fallback. |
| WEB-02 | P1 | A saved active channel starts message requests before identity restoration. This can fail authentication and put shared transport into its five-second cooldown. | Gate private requests on restored identity and resolved channel. |
| WEB-03 | P1 | Live reload created over 25 relay WebSockets. Each live subscription authenticates its own socket despite queries already sharing a transport. Shared connection readiness also lacks a deadline. | Multiplex subscriptions, bound connection/authentication, reconnect and reset on identity change. |
| WEB-04 | P1 | Channel query errors render first-channel/invitation setup. Message query errors can render an empty conversation. | Distinguish failed reads from successful empty results; offer retry. |
| WEB-05 | P1 | At 390 × 844, selecting Inbox hides the sidebar and leaves no visible navigation control. Alerts and Agents have the same missing control in source. | Persistent mobile navigation control for these views. |
| WEB-06 | P2 | Live initial JS asset is 2,118,385 bytes decoded. Every route and the full emoji dataset/index are eagerly loaded. | Split route components and defer emoji code/data until requested. |
| WEB-07 | P1 | Sidebar handlers only changed component state: from `/messages/new`, selecting a channel retained the new-message route; view/channel URLs also failed to track navigation and reload. Local regression exercises the actual clicks and browser Back. | Route-aware channel/view navigation; preserve Inbox on reload, leave new-message mode, clear stale thread state. |
| WEB-08 | P2 | Opening the emoji search box and pressing Escape left its dialog open in the browser test: the picker consumed the key before the window listener. | Capture Escape while the dialog is open, close it and restore trigger focus. |

All rows are **fixed, locally tested, and deployed**. WEB-01 is a confirmed implementation failure path reproduced with storage fault injection; it does not establish why the user's original browser storage was unavailable after deployment.

## Runtime observations

- Existing identity restored automatically on the audited reload. Repeated post-deployment setup is user-reported, but was not reproduced; WEB-01 fixes a confirmed error path, not a proven production data-loss cause.
- Warm reload: document TTFB about 98 ms; DOMContentLoaded 284 ms; first contentful paint 604 ms; document load 617 ms. These are browser measurements, not a cold-network benchmark. The UI still showed Connecting at the first approximately 915 ms observation.
- Search returned 17 results for VarVik. Opening a result selected the correct channel and thread.
- Inbox, Alerts, agent directory, settings, reminders and projects rendered. No console errors were captured during that inspection.
- Older channel messages contain agent runtime authentication errors. These are historical evidence, not confirmation that the current runner is broken; credentials were not changed.
- Browser viewport and original channel restored after inspection.

## Validation

- `pnpm --dir web check`: passed formatting, lint, file-size, public-key display, theme-catalog checks and **153 unit tests**.
- `pnpm --dir web typecheck`: passed.
- `pnpm --dir web build`: passed. The deferred emoji chunk remains about 506 KB and produces a chunk-size warning; it is not requested at startup.
- `pnpm --dir web exec playwright test --project=smoke`: **40/40 passed**, including eight new regression workflows. Covers sign-in/reload/lock, shared transport and reconnect, injected storage/channel/message read failures, mobile navigation, deferred emoji and Escape, and route history. Existing coverage also exercised messages, threads, reactions, media, profiles/search, hosted-agent controls, workflows, invites, pairing, preferences and projects.
- The local mock retains real React, IndexedDB, password encryption and browser rendering; relay events are simulated. No production test messages or credential changes were made.
- Browser-observed startup asset names, summed against their production build files: **1,025,935 bytes of JavaScript** versus **2,118,385 bytes** in the observed live bundle (**51.6% less**). Cached resource entries report zero decoded bytes, so file sizes were used rather than interpreting zeros as free transfers. This is an asset-size comparison, not a production latency claim.
- Reload regression: **one WebSocket and one authentication**, versus more than 25 sockets observed during the live reload. Reconnect and sign-out teardown pass.
- Mobile Inbox screenshot inspected at 390 × 844: navigation control remains visible and usable. Screenshot is in the Playwright test-results directory; HTML report is `web/playwright-report/index.html`.
- Impeccable detector: no mechanical findings in changed UI targets. React Doctor reported 74/100 with four warnings: two component-complexity warnings, one related-state organization warning, and one prop-to-state synchronization warning. The latter is intentional synchronization of the thread panel with browser navigation, exercised by the route tests; the remaining warnings are maintainability debt, not evidence of additional broken workflows.
- `git diff --check` and redacted staged secret scan: passed. Published through draft PR #79 because `main` requires pull requests.
- `just ci` attempted: workspace Rust checks passed, then desktop Tauri clippy failed on five unused-variable/dead-code diagnostics in unchanged tray files. The full repository gate is not green.

### Production admission regression

The first release served the expected split assets and retained the saved account, but channel discovery failed with `rate-limited: quota exceeded; retry in 1s`. The relay limit is principal-scoped (shared by the signed-in account), not a separate allowance per socket. Production was rolled back to the previous healthy image.

The follow-up honors bounded relay retry hints for query and live subscriptions, pauses pending sends for that deadline, and reconnects interrupted reads on the shared socket rather than opening a dedicated socket per read. Normal requests have no fixed pacing delay. A new browser regression enforces the relay's 50 requests per five seconds budget and injects a throttle response during startup. Full smoke coverage passed: 40/40 tests, including the admission regression (36.9 seconds total).

## Post-deployment verification

- Running source: `e0992e693f3d1c5640b522e0bd40b0de577171cb`; draft [PR #79](https://github.com/Cvv9/buzz/pull/79). The source is published on `codex/web-startup-quality`; it is not merged into protected `main`.
- Production image: `buzz-web-audit:e0992e693`, local image digest `sha256:a911462bf644ca7415911c3f32f27aa3a9d32c89b3774c7d6816fa663eec0448`. Built on the exact previously running 0.2.16 relay digest; only bundled web files changed. Health check passed. Database, Redis, bridge, controller, and agent containers remained running.
- Served entry: `/assets/index-BYjCIJF4.js`. HTTP-cache-disabled startup requested **1,027,341 decoded JS bytes**, **342,804 transferred bytes** (including resource overhead): **51.5% less decoded startup JavaScript** than the original 2,118,385-byte entry bundle. The emoji palette remained deferred until opened.
- In one cache-disabled navigation, TTFB was **69 ms**, DOMContentLoaded **262 ms**, load **328 ms**, and first contentful paint **424 ms**. In a separate completely captured cache-disabled run, the composer was observed at **1,028 ms**, with **one WebSocket and one AUTH**. These are lab observations in the existing Chrome profile, with browser identity retained, not field percentiles or a new-device benchmark. The readiness observation is an upper bound, not an exact rendering timestamp.
- That fully captured run received **eight background throttle responses** and recovered automatically. No failed-connection screen remained. This is a remaining request-efficiency gap, even though retry handling now prevents the observed failure.
- The saved Varun identity restored without entering a recovery key or new password after deployment. This demonstrates this release preserves that browser's account; it does not establish the root cause of the original report or guarantee behavior after clearing browser storage.
- Inbox persisted at `/?view=inbox` across reload. Mobile Inbox, Alerts, and Agents retained a working navigation control. Emoji search Escape closed the loaded picker. Search returned **17 results** for VarVik.
- Agents had no document horizontal overflow at **320, 390, 768, and 1440 px**. Mobile controls still measured **110 × 32 px** (New agent) and **112 × 32 px** (Edit profile).
- Inbox secondary text uses white at 35% and 40% opacity over the observed `rgb(16,16,16)` background: approximately **3.20:1** and **3.82:1** contrast after compositing. These are confirmed gaps for ordinary text under this audit's 4.5:1 target.
- No console errors were captured in the final UI pass. HTTP-cache and viewport overrides were reset; the workspace returned to market-intelligence. No production test messages or account-setting changes were made.

## Initial reassessment and path to 20/20

The rubric totals five dimensions at four points each. Full marks mean **4/4 in every dimension**, not an arbitrary score increase after deployment. This remains a bounded web assessment, not a whole-product accessibility certification.

| Dimension | Before follow-up / 4 | Work required for 4/4 | Acceptance evidence |
|---|---|---|---|
| Accessibility | 2 | Replace low-contrast secondary text; audit keyboard focus, mobile off-canvas navigation, form labels/errors, dialogs, and reduced motion. The off-canvas sidebar currently uses translation without an explicit inert/focus boundary in source. | Text meets the audit's 4.5:1 target; critical flows complete with keyboard and a screen reader; hidden navigation cannot receive focus; dialogs close and restore focus; reduced-motion behavior is verified. |
| Performance | 3 | Consolidate redundant startup queries and subscriptions so ordinary startup does not depend on throttle retries. Further defer nonessential code from the still roughly 1 MB decoded startup payload. | Repeated cold and warm runs under an agreed mobile/network profile, including a populated account and two tabs; no startup throttle rejections or connection fan-out; preserve the observed fast composer readiness with measured results, not just smaller files. |
| Responsive design | 3 | Increase 32 px agent buttons and other undersized controls to the audit's 44 px touch target. Validate forms, dialogs, composer, and navigation beyond the Agents page. | No overflow or unreachable controls at 320/390/768/1440 px, landscape, and 200% zoom; mobile keyboard does not obscure the composer or actions; touch targets meet 44 px. |
| Theming | 2 | Replace hard-coded translucent white/black text and surfaces with semantic foreground, muted, border, and status tokens across Inbox, sidebar, agent panels, and related flows. | Light, dark, and supported custom themes tested on populated, empty, loading, disabled, error, hover, and focus states; contrast remains readable after switching. |
| Implementation integrity | 3 | Resolve the existing desktop tray CI diagnostics; add production-like admission coverage to release validation; automate release/rollback verification with retained browser identity. Investigate repeated setup if it recurs without ever logging private keys. | Full repository gate is green; release workflow checks account preservation, relay quotas, reconnect, and URL history; the reproducible web image is published through the normal registry/release pipeline. |
| **Total** | **13 / 20** | **Significant work remains before full marks.** | **Do not claim 20/20 until these checks pass.** |

Recommended next batch: accessibility, touch targets, and semantic theme tokens together, because the same components are involved. Follow with request consolidation and production-like release tests. Reassess each completed batch against these acceptance checks.

### Release reproducibility and rollback

The server retains the exact source archive, web-only Dockerfile, and image under its existing build area. The deployment environment has a persistent image override. The prior environment and exact base image were retained for rollback. This locally built image is sufficient for the current host, but moving it to the normal registry pipeline is required for automatic recovery on a replacement host. Avoid a general image pull against this local-only tag.

The implementation preserves the existing product identity and Nostr authentication model. No server-side username/password account system or new HTTP API was introduced. Name/password-only recovery on a fresh browser remains outside the current identity model.

## Follow-up quality batch

The follow-up batch fixes the confirmed focus, touch-target, contrast, and release
reproducibility findings together:

- Native modal dialogs contain Tab/Shift+Tab, close with Escape, make the
  background inert, and restore the invoking control. Channel creation,
  membership, editing, settings, the guide, and agent provisioning share it.
- Off-screen mobile navigation is inert. Opening it contains keyboard focus;
  closing it restores focus and unlocks the workspace content.
- Workspace secondary text and neutral surfaces use theme tokens. Inbox read
  items keep readable text; dismiss controls remain visible on touch screens.
- Mobile workspace/dialog controls have 44-pixel minimum targets; mobile form
  text avoids automatic input zoom. Narrow layouts and enlarged text have
  browser regression coverage.
- Secondary workspace panels load on demand. Recipient profiles load only
  when composing a direct message or adding members. Initial profile/status
  queries wait for the first roster and message results, avoiding repeated
  requests as the startup author set grows. Live invalidation remains intact.
- macOS excludes unused Windows/Linux tray helpers, fixing the prior CI errors.
- `Dockerfile.web` and the Browser release workflow publish a browser-only
  image while retaining the explicitly pinned production relay binary. A
  `web-<12-character source SHA>` tag produces `ghcr.io/cvv9/buzz:web-<full SHA>`;
  production should reference the resulting registry digest. No mutable
  `latest` tag or relay protocol upgrade is part of this release.

React Doctor reports 71/100 on the complete branch diff. Its existing
complexity/state findings are documented below; it reports no errors. These maintainability warnings are retained as follow-up
work rather than suppressed or used as proof of user-facing failures.

### Follow-up validation

- Full `just ci` completed successfully: repository Rust checks/tests, desktop
  checks/build and 5,062 JavaScript tests, 2,531 Tauri tests (17 explicitly
  ignored), web checks/build and 153 unit tests, mobile analysis and 1,465 tests.
  Existing infrastructure-only ignored tests remain outside this gate.
- The 43-test browser smoke suite passed after profile refresh batching. The
  final callback timing adjustment also passed the keyboard-focus regression
  and a fresh production build.
- Browser coverage includes 320/390/768/1440 widths, a 390×400 viewport with
  200% root text scaling, mobile control dimensions, inert navigation,
  Tab/Escape/focus restoration, and Inbox paragraph contrast ≥4.5:1 in Buzz
  light/dark and GitHub light/dark. Paired Buzz screenshots were inspected.
- Final React Doctor review: 71/100, no errors, nine warnings. Eight concern
  existing complexity/state; one dependency warning is a false positive: the
  memo explicitly depends on the accessed `channelsQuery.isPending` value. This tool score is separate from the bounded usability assessment.

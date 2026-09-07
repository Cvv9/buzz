# Web usability audit — 7 September 2026

Scope: live `https://buzz.varvikstudios.com/` in the existing Chrome session, desktop and 390 × 844 viewport; source review and local regression tests. All eight initial issue groups below are fixed. The first production verification caught a relay-admission regression and the release was rolled back; the follow-up adds admission-aware retries before redeployment. No production messages, invitations, agent permissions, or credentials were changed.

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

All rows are **fixed and validated locally**. WEB-01 is a confirmed implementation failure path reproduced with storage fault injection; it does not establish why the user's original browser storage was unavailable after deployment.

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

The follow-up honors bounded relay retry hints for query and live subscriptions, pauses pending sends for that deadline, and reconnects interrupted reads on the shared socket rather than opening a dedicated socket per read. Normal requests have no fixed pacing delay. A new browser regression enforces the relay's 50 requests per five seconds budget and injects a throttle response during startup. Full smoke coverage is rerun before redeploying.

## Focused quality assessment

Scores describe this bounded audit, not a whole-product accessibility certification.

| Dimension | Score / 4 | Finding |
|---|---|---|
| Accessibility | 2 | Escape and retry controls verified; contrast and the full keyboard surface were not exhaustively measured. |
| Performance | 3 | Startup payload and connection fan-out reduced; a cold production-network timing comparison remains outstanding. |
| Responsive design | 3 | Confirmed mobile navigation trap fixed and exercised at 390 × 844. |
| Theming | 2 | New controls use existing theme tokens; older hard-coded colors remain elsewhere. |
| Implementation integrity | 3 | Failed reads no longer pretend to be successful empty/account-setup states; existing workspace complexity remains. |
| Total | 13 / 20 | Acceptable within the audited scope; significant broader quality work is not claimed complete. |

The implementation preserves the existing product identity and Nostr authentication model. No server-side username/password account system or new HTTP API was introduced. Name/password-only recovery on a fresh browser remains outside the current identity model.

This audit is bounded to the workflows above. It does not certify all features or external agent services.

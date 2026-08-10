# Buzz Web production audit — 2026-08-10

## Scope

Read-only walkthrough of the signed-in production web app at
`https://buzz.varvikstudios.com` in Chrome. The audit covered the workspace,
channels, inbox, alerts, agents, agent editing, settings, profile editing,
workflows, reminders, search, projects, repositories, saved channel state,
offline archive, browser pairing, moderation, identity archive, and channel
settings.

No messages, settings, agents, workflows, memberships, or destructive actions
were submitted. Opening pages did expose two state-management defects described
below.

## Implementation status — 2026-08-10

The source fixes from this audit are implemented in the current Buzz and
VarVik Suite working trees, but they have **not** been committed, pushed, or
deployed. Production will continue to show the old behavior until the relevant
web and relay images plus the Suite configuration are released.

| Finding | Status | Delivery note |
| --- | --- | --- |
| 1. Unread route loss | Fixed in source | Read projections and cursors now survive unrelated route unmounts and remain scoped by relay and identity. |
| 2. Reminders cold load | Fixed in source | `/reminders` has an independent identity-gated page and direct-load coverage. |
| 3. Unavailable approval node | Fixed in source | The node is visibly unavailable and web rejects new approval-gate YAML while retaining historical read support. |
| 4. Duplicate production schedules | Partially fixed | Suite reconciliation now reports exact conflicting workflow IDs, but the live duplicates still require authenticated operator cleanup; SSH to the production node was unavailable during this pass. |
| 5. Automation shown as `7` | Fixed for new relay output | Workflow messages carry stable workflow metadata and render with an Automation/Workflow presentation. Existing messages receive a safe legacy label. Requires relay + web deployment. |
| 6. Agent names/roles | Fixed in source configuration and presentation | Lanaya's meaningful role wins over the legacy `Io` alias; canonical deployed profiles still need Suite reconciliation/republishing. |
| 7. Role editing contract | Deferred safely | The public hosted-config relay schema is deliberately strict. Expanding it requires a coordinated relay/desktop/web contract and authorization change, not an unvalidated web-only field. |
| 8. Runtime provider/model control | Deferred infrastructure | The existing model field remains honest presentation/desired state. Real Claude/Codex switching needs the separately designed host-side controller and effective-state acknowledgements. |
| 9. Agent access scale/context | Fixed in source | Access is grouped and searchable and stale current-channel context is removed from direct agent management. |
| 10. Duplicate membership candidates | Fixed in source | Candidates are deduplicated by pubkey and owners no longer receive an ordinary remove action. |
| 11. Settings navigation | Improved | Duplicate Web tools navigation was removed and standalone pages now share a settings breadcrumb. Full previous-channel route restoration remains a later shell-level enhancement. |
| 12. Workflow builder | Improved within the current schema | Channel memory and capability-gated web/library tools are implemented. The UI now states that execution is linear; a true branching graph remains blocked on a canonical relay schema upgrade. |
| 13. Raw identifiers | Improved | Pages now provide human-readable lookup guidance. Full entity pickers and archive restoration remain follow-up work. |
| 14. Pairing QR | Fixed in source | Source QR, expiry, capability-gated camera scan, explicit confirmation, cleanup, and manual fallback are implemented. |
| 15. Custom emoji upload | Fixed in source | The existing validated relay media picker/upload path is reused. |
| 16. Repository shell | Fixed in source | Repository loading, empty, error, and list states now share the workspace navigation/theme shell. |
| 17. Historical test traffic | Operational follow-up | No production history was deleted. Health traffic needs a dedicated channel/retention policy before safe cleanup. |

## Release blockers / P0

### 1. Unread state disappears when navigating to Reminders

- Before opening Reminders, the sidebar showed numeric unread badges including
  `github-events: 67`, `market-intelligence: 8`, and `brief-varun: 2`.
- Opening Reminders from the workspace removed all of those badges even though
  none of those channels had been opened.
- This violates the intended read cursor behavior: navigation to an unrelated
  page must not mark channels read or discard locally projected unread state.

Required fix:

- Persist read cursors per identity, relay, and channel.
- Rehydrate unread projections after route changes/reconnects.
- Only advance a channel cursor after that channel's timeline is actually
  viewed through the relevant point.
- Add E2E coverage for unread counts surviving Settings, Reminders, Agents, and
  reconnect navigation.

### 2. Reminders cannot be loaded directly

- A direct visit/refresh at `/reminders` remained indefinitely on
  `Connecting to VarVik Studios…` after multiple five-second checks.
- Entering Reminders through the already-initialized workspace did work.

Required fix:

- Make `/reminders` initialize identity, relay, and reminder state independently
  on a cold route load.
- Add direct-load and hard-refresh Playwright coverage, not only client-side
  navigation coverage.

### 3. Workflow approval is exposed although execution is unavailable

- The visual workflow palette includes `Request approval`.
- The same page states that the relay does not emit approval-request events
  end-to-end.

Required fix:

- Either finish relay emission/action of approval events before exposing the
  node, or mark the node unavailable with a precise explanation.
- Prevent saving workflows that contain execution paths the deployed relay
  cannot run.

## High priority / P1

### 4. Duplicate scheduled workflow messages are reaching channels

- `brief-varun` contained repeated identical 8:30 AM founder-brief requests.
- `market-intelligence` contained repeated identical 9:00 AM market-scan
  requests and repeated error responses.

Required fix:

- Audit active production workflow IDs and remove duplicate unmanaged schedules.
- Add an idempotency key per workflow occurrence and reject duplicate delivery.
- Provide an operator view showing the workflow responsible for each generated
  message.

### 5. Legacy automation identity is presented as `7`

- Scheduled messages are rendered with a square `7` avatar and the truncated
  pubkey `7f415350…9322` instead of a recognizable integration/workflow name.

Required fix:

- Publish and resolve a named profile for the automation signer.
- Render an explicit `Automation`/`Workflow` badge and originating workflow
  name.
- Avoid treating an integration signer as a normal hosted agent.

### 6. Agent identities and role labels are inconsistent

- The roster shows `Rexar — Market Intelligence`, while current operational
  messages and deployment configuration refer to Mirana.
- `Lanaya — Io` is not a meaningful role description and conflicts with
  Lanaya's personal-assistant/daily-planning purpose.
- Historical messages continue to show stale names, making it unclear which
  deployed agent actually responded.

Required fix:

- Establish one canonical display name and role per agent and republish the
  public directory/profile heads.
- Fix replacement-event invalidation so web and desktop converge immediately.
- Decide and document historical-message presentation: current canonical name
  with an optional historical-name marker is preferable.

### 7. Agent role/description cannot be edited in the web editor

- The hosted-agent editor supports name, picture upload, and desired model.
- It does not expose the short role/description shown in the roster, so an
  incorrect label such as `Lanaya — Io` cannot be corrected from the web app.

Required fix:

- Add an authorized, validated role/summary field to the public hosted-agent
  presentation contract and both clients.
- Keep the summary short and show it consistently in the roster, mentions, and
  detail view.

### 8. Model selection is presentation state, not reliable runtime control

- The editor currently offers only `Runtime default` and `gpt-5.6-sol`.
- The page correctly warns that the hosted runtime applies the desired model
  only when operator runtime control is enabled.
- Claude/Codex provider selection is therefore not available from the web app,
  and saving the displayed model must not be interpreted as proof of a runtime
  change.

Required fix:

- Keep the honest limitation copy.
- Build the separately scoped host-side provider/runtime controller before
  exposing provider switching.
- Show acknowledged effective provider/model alongside desired configuration,
  including failure/rollback state.

### 9. Agent channel access management does not scale

- The agent detail view presents roughly 38 ungrouped channel checkboxes.
- There is no search, section filter, select-all-by-section, or clear indication
  of inherited/default access.
- The detail view also displayed `Current channel #brief-varun` after entering
  Agents directly, leaking stale workspace context into management.

Required fix:

- Group channels by catalog section, add search/filtering, and distinguish
  direct versus inherited access.
- Only show current-channel context when Agents was opened from that channel.

### 10. Channel membership picker contains duplicate identities

- The `agent-lab` invite picker listed `Sylars Work Manager` twice.
- The owner row also displayed a `Remove` action, which is misleading even if
  the relay ultimately rejects it.

Required fix:

- Deduplicate candidates by canonical pubkey before display.
- Hide or disable owner removal and explain ownership transfer requirements.

## Medium priority / P2

### 11. Settings navigation is inconsistent and repetitive

- Settings has both a left navigation and a second `Web tools` card list with
  many of the same destinations.
- Several destinations (`/preferences`, `/channel-state`, `/offline`,
  `/identity-archive`, `/moderation`) use standalone layouts with inconsistent
  or absent Settings breadcrumbs.
- Moving between Settings and the workspace remains a full-page context switch
  instead of preserving the previous channel/context.

Required fix:

- Use one shared settings shell and one navigation system.
- Preserve and restore the source route when returning to the app.
- Remove duplicate destination cards unless they add meaningful status or
  onboarding information.

### 12. Workflow builder is still linear rather than an n8n-style graph

- The visual builder is a substantial improvement and includes agent, web,
  library-tool, message, approval, webhook, and wait nodes.
- It is still a single linear step lane without branches, connections, error
  paths, or a true drag-and-drop graph.
- The initial channel was `#aaral-pms`, apparently alphabetical rather than
  current/recent context.
- Web/tool nodes are generic instructions rather than visibly constrained by
  the selected agent's published capabilities.

Required fix:

- Add a graph model with typed ports, branching, validation, and explicit error
  paths.
- Populate tool choices from an audited capability catalog and prevent invalid
  agent/tool combinations.
- Remember the last selected channel or accept channel context on navigation.

### 13. Search and management pages expose internal identifiers

- Search filters require a raw channel ID and 64-character author pubkey.
- Saved channel state requires raw channel/thread IDs.
- Moderation requires raw event IDs and author pubkeys.
- Identity archive is a list of full pubkeys without resolved names, search,
  context, dates, actors, or obvious unarchive actions.

Required fix:

- Add channel, person, and message pickers while retaining an advanced raw-ID
  option.
- Resolve identities to canonical names/avatars.
- Show audit metadata and authorized restore/unarchive actions.
- Add message-context actions such as `Report` and `View moderation record`.

### 14. Pairing lacks QR generation and scanning

- Pairing currently depends on copying/pasting a `nostrpair://` code.
- The page explicitly states that QR rendering/camera scanning is unavailable.

Required fix:

- Add QR generation for the source and a permission-gated scanner for the
  target, while preserving the existing SAS confirmation and manual fallback.

### 15. Custom emoji accepts only an image URL

- Profile and hosted-agent images now support secure local uploads.
- Custom emoji still asks for a raw image URL, creating an inconsistent and less
  accessible media flow.

Required fix:

- Reuse the validated relay media upload flow for custom emoji.
- Validate dimensions, MIME type, size, and animated-image policy.

### 16. Repository pages use a separate minimal shell

- `/repos` renders an isolated empty-community page with only `Open in Buzz`,
  unlike the rest of the web workspace and project pages.

Required fix:

- Integrate repository empty state and browsing into the shared web navigation
  and theme shell.

### 17. Historical test traffic remains mixed with production conversation

- `agent-lab` contains many `AGENT-CHECK` and `AGENT-RETEST` messages and their
  replies.
- This makes normal use and agent health interpretation noisy.

Required fix:

- Send automated health checks to a dedicated test/health channel or mark them
  as collapsible system events.
- Provide retention/cleanup for test traffic without altering normal history.

## Verified as working in this audit

- Numeric unread badges are rendered (for example `67`, `8`, and `2`) rather
  than category totals or dots. Persistence is the broken part described in P0.
- Channel category totals such as `6`, `7`, and `4` are no longer shown.
- Profile and hosted-agent editors support local image upload to the relay.
- Theme mode, theme family, and accent controls are present.
- Channel-setting native selects currently compute to a dark color scheme with
  dark option backgrounds and readable light text; the previously reported
  white dropdown contrast issue appears fixed in the deployed build.
- Inbox and Alerts render their empty states correctly.
- No browser console warnings or errors were emitted during the walkthrough.

## Recommended delivery order

1. Fix unread cursor persistence and direct-load Reminders.
2. Remove duplicate production schedules and name the automation signer.
3. Correct canonical agent names/roles and add role editing.
4. Gate workflow nodes by deployed relay/runtime capabilities.
5. Consolidate the settings shell and replace raw identifiers with pickers.
6. Add graph workflows, QR pairing, custom-emoji upload, and remaining UX
   polish.

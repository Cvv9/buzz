# Web/Desktop Feature Parity Scope

## Purpose and decision rules

This document is the implementation scope for making `web/` a first-class Buzz
client without weakening the relay's Nostr-first model or silently treating a
desktop-local capability as browser-safe. It is based on the current desktop
routes/features, the browser workspace and repository clients, relay ingest and
command handlers, the kind registry, the architecture guide, and the existing
browser and desktop E2E suites.

It is deliberately a **capability plan**, not a promise to recreate the Tauri
shell inside a tab. A web feature is at parity when a browser user can perform
the same user-facing collaboration operation with the same source of truth,
authorization, and realtime behaviour. Where desktop's implementation depends
on a locally-running process or operating-system privilege, parity needs a
separate browser-safe architecture rather than a hidden browser bypass.

### Labels

| Label | Meaning |
| --- | --- |
| **Already equivalent** | The web client already implements the meaningful collaborative operation against the same relay source of truth. Follow-up is regression protection or desktop-polish parity. |
| **Directly portable in browser** | A client UI/state feature. It can use the existing Nostr signer, WebSocket client, query bridge, and browser storage; no relay behaviour change is required. |
| **Portable through existing relay events** | The relay already owns the operation and exposes an event/command contract. Implement the browser reader/writer and subscriptions; do not add an endpoint-specific JSON API. |
| **Portable with browser APIs/adapters** | The relay contract exists, but the browser needs an explicit Web API or a compatible adapter (for example File/Blob, Web Audio, IndexedDB, WebCrypto, or a service worker). |
| **Needs new browser-safe/server architecture** | Desktop uses a native process, privileged local data, background execution, or a service that the relay does not currently expose safely to a browser. Define and secure that service first. |
| **Desktop-only** | An OS-shell behavior with no useful in-browser equivalent. It remains a desktop differentiator; a browser must not emulate it through unsafe local access. |

Priority is **P0** (correctness/security prerequisite), **P1** (core
collaboration), **P2** (important workflow), and **P3** (polish or optional).
Effort is relative: **S** ≤ a small feature slice, **M** a bounded feature,
**L** several coordinated client/relay surfaces, **XL** a new service or
protocol.

### Non-negotiable protocol and security rules

1. The relay remains authoritative for membership, channel roles, event
   authorization, workflow execution, media access, and git policy. Browser
   code performs UX gating only; it must never rely on the gate for security.
2. Channel-scoped content uses an `h` tag. NIP-29 metadata and membership
   projections use `d` tags: channel metadata `39000`, member projection
   `39002`, commands `9000`/`9001`/`9002`/`9007`/`9008`. A browser must not
   introduce a local channel catalogue.
3. All writes use a signed Nostr event through the authenticated WebSocket or
   the existing generic `POST /events` bridge. Reads use WebSocket `REQ` or the
   authenticated `POST /query` bridge. New product operations should not add
   bespoke HTTP JSON endpoints.
4. Treat relay-signed snapshots (`13535` identity archive and `30622` DM
   visibility) as relay-scoped. Verify the advertised NIP-11 relay identity
   when the cross-client signature-verification hardening lands; until then
   preserve the current authenticated-transport trust model uniformly rather
   than verifying one snapshot family only.
5. Browser keys stay in the current encrypted browser identity/NIP-07 signer
   boundary. Do not send an `nsec`, a managed-agent secret, local archive data,
   or a terminal command to a new service merely to achieve parity.
6. Privacy-sensitive reads remain filtered by the relay: author-only reminder
   `30300`, encrypted read state `30078`, gift wraps, agent engrams `30174`,
   DM visibility `30622`, private managed-agent state, and push leases must
   never be made broadly queryable in browser code.

### Current browser baseline

The web app is not just the repository browser. Its `/` workspace already has
an encrypted local browser identity (or NIP-07), NIP-42/NIP-98-capable relay
access, channels, streamed messages, thread replies, edit/delete, reactions,
read-state synchronisation, Inbox/Alerts, hosted-agent discovery and
mention-driven membership, channel administration, shared community appearance,
and foreground browser notifications. It also has `/invite/$code` and a
read-only `/repos` browser backed by `isomorphic-git` + LightningFS/IndexedDB.

The browser intentionally does **not** yet expose most desktop routes. Its
internal workspace views (`channel`, `inbox`, `alerts`, `agents`) are not
separate URLs, so each new major surface should gain a URL-addressable route
unless it is a short-lived overlay.

### Required protocol cleanup before feature work

| Item | Required outcome | Priority / effort | Owner boundary |
| --- | --- | --- | --- |
| Hosted-agent config kind collision | Use **`30180`** as the canonical public hosted-agent configuration event. `30179` is reserved for the encrypted private managed-agent aggregate; readers must support a deliberate migration window and reject/avoid ambiguous `30179` interpretations. | P0 / L | core + relay + desktop + web |
| Browser protocol constants | Move browser constants out of the monolithic workspace API into a tested protocol module generated from, or contract-tested against, `buzz-core/src/kind.rs`. | P0 / M | web + core contract tests |
| Realtime invalidation convention | Every queryable projection needs initial fetch, `since` subscription, de-duplication by event id, replacement-head ordering `(created_at DESC, id ASC)`, mutation invalidation, and a community/identity reset. | P0 / M | web platform |
| Relay-signed snapshot verification | Add one shared verifier for NIP-IA/NIP-DV and future relay-signed projections, using the configured relay's NIP-11 `self` key. | P1 / M | web + desktop |

The rest of this plan refers to the target public hosted configuration kind as
`30180`. During migration, compatibility reads must be explicit and temporary;
they must not make private `30179` payloads visible to browser readers.

## Summary matrix

| Feature area | Classification | Priority / effort | Primary source of truth |
| --- | --- | --- | --- |
| Browser identity, invite, community appearance | Already equivalent | P1 / S | encrypted browser identity; kinds `0`, `30078`; invite relay API |
| Channels and channel administration | Already equivalent | P1 / M | NIP-29 `39000`/`39002`, commands `9000`–`9002`, `9007`/`9008` |
| Messages, threads, edits, deletion, reactions | Already equivalent | P1 / M | `9`, `40002`, `40003`, `7`, `5`/`9005`; `h`/`e`/`p` |
| Inbox, Alerts, read state | Already equivalent | P1 / M | `46010`, `30078`, message `p`/`e` tags |
| Hosted-agent discovery and mention delivery | Already equivalent | P0 / M | `10100`, public config `30180`, NIP-29 membership, message `p` |
| Repository browser | Already equivalent | P1 / M | NIP-34 `30617`/`30618`, git smart HTTP |
| Profile/status and global search (first browser package delivered); advanced channel preferences | Directly portable | P1 / M | `0`, `30315`, `10000`–`10003`, `40004`–`40007`, NIP-50 |
| Pulse, forums, emoji, moderation, identity archive | Directly portable | P1–P2 / M–L | existing kinds and relay validation |
| Project collection and git work items | Delivered read-only browser slice | P1 / L | `30621`, NIP-34 issues/PRs/statuses/comments, exact `a` tags |
| DMs, presence/typing, workflow control | Portable through existing relay events | P1 / M–L | `41010`–`41012`, `30622`, `20001`/`20002`, `30620`, `46020`, `46030`/`46031` |
| Reminders | Portable through existing relay events | P1 / M | author-only encrypted `30300`, `d`/`not_before` |
| Media, huddle audio, local archive, pairing, foreground notifications | Portable with browser APIs/adapters | P1–P2 / M–L | Blossom, huddle WS, IndexedDB/WebCrypto, Web Audio, Notification API |
| Background push, managed agents, agent memory/control, terminal, mesh compute | Needs new browser-safe/server architecture | P0–P2 / XL | new explicitly-authorized services; existing events remain projections |
| Tray, native updater/window controls, local process/terminal launch | Desktop-only | — | Tauri/OS |

## Already equivalent

### 1. Browser identity, joining, community appearance, and basic settings

- **Canonical contract.** Browser identity is encrypted local key material or a
  NIP-07 signer; relay identity/auth is NIP-42 for WebSocket and NIP-98 for
  HTTP. Human profile compatibility is kind `0`. Shared per-user appearance is
  self-encrypted `30078` with `d=community-theme`. Invites use the existing
  relay invite flow, not a client-created membership shortcut.
- **Desktop writer/read.** Desktop identity and community initialization are in
  `desktop/src/features/onboarding/` and `communities/`; theme sync is in
  `desktop/src/shared/theme/communityThemeSync.ts`; settings own recovery and
  profile controls.
- **Web current state.** `web/src/shared/lib/browser-identity.ts` stores a
  password-protected browser identity; `IdentityGate.tsx` supports recovery-key
  sign-in; `CommunityThemeController.tsx` decrypts and subscribes to the theme
  coordinate; `WorkspaceSettings.tsx` exports the recovery key, locks the
  browser identity, and mints browser invites.
- **Implementation tasks.** Retain the existing behavior; add a profile editor and
  broader community-management settings in the directly-portable slices below.
  Keep community/identity changes as a full React-query/cache reset, not merely
  a route transition.
- **Cache/realtime.** Scope IndexedDB/localStorage keys and React Query keys by
  relay origin and pubkey. Subscribe to the precise `30078` coordinate after
  unlock and clear decoded state on lock/switch.
- **Security/authorization.** Never export or log the private key except on a
  user-initiated reveal. Preserve password KDF/version migration and NIP-07
  fallback tests. Invites still require relay owner/admin authorization.
- **Tests/dependencies.** Keep
  `web/tests/e2e/workspace-identity-and-agents.spec.ts` and theme unit tests;
  add a cross-device theme round-trip and locked-state cache-clearing test.
  Depends on the current browser signer and relay auth client. **P1 / S.**

### 2. Channels, membership, catalogue sections, and basic administration

- **Canonical contract.** Relay-signed channel metadata is `39000` keyed by
  `d=<channel-id>`; membership is `39002` keyed by `d`; in-channel events use
  `h=<channel-id>`. Writes are NIP-29 `9007` create, `9000` add/role, `9001`
  remove, `9002` metadata/archive/catalog section, and `9008` delete. The
  relay, not either client, enforces owner/admin/member permissions.
- **Desktop writer/read.** `desktop/src-tauri/src/commands/channels.rs` and
  `desktop/src/features/channels/` perform create/update/archive/join/leave and
  read relay projections.
- **Web current state.** `workspace-api.ts` reads the same `39000`/`39002`
  heads, publishes the same management kinds, and
  `WorkspaceChannelSettings.tsx`/`WorkspaceSidebar.tsx` provide create,
  metadata, membership, roles, archive/delete, sections, stars, and unread
  presentation.
- **Implementation tasks.** Preserve direct parity and add the desktop's join/leave
  and channel-browser/template flows as a separate direct-portable slice. Make
  all channel mutations optimistic only after validating the projected change;
  reconcile from `39000`/`39002` rather than maintaining a separate local copy.
- **Cache/realtime.** Invalidate/refetch `['workspace-channels', viewer]` and
  relevant members/details after every command; subscribe to the discovery
  projections and channel command/system events where relay fan-out makes them
  observable. Community switch clears favourites, collapsed sections, and
  local read markers for the old relay.
- **Security/authorization.** Do not infer private channel discovery from
  names. Preserve the current admin-only private catalogue policy and relay
  authorization errors; only an authorized owner/admin may auto-add an agent.
- **Tests/dependencies.** Existing web channel policy unit tests and workspace
  smoke tests cover the core. Add role downgrade/removal, private discovery,
  catalogue-section clear, archive/unarchive, and cross-client projection E2E.
  **P1 / M.**

### 3. Channel messages, NIP-10 threads, edits/deletes, and reactions

- **Canonical contract.** Conversational messages are `9` and `40002` with
  `h`; edits are `40003` with `h` and target `e`; deletions are NIP-09 `5` or
  NIP-29 `9005`; reactions are `7` with target `e`. Thread root/reply semantics
  use NIP-10 `e` markers (`root`, `reply`). Mentions are `p` tags. Thread root
  counters remain relay materialized data and must not be recomputed as an
  authoritative write by the browser.
- **Desktop writer/read.** `desktop/src/features/messages/`,
  `desktop/src-tauri/src/commands/messages.rs`, and chat/thread views query,
  subscribe, page, and mutate this event set.
- **Web current state.** `workspace-api.ts`, `workspace-messages.ts`,
  `WorkspaceMessageRow.tsx`, and `useWorkspaceReactions.ts` send, reply,
  edit/delete, materialize edits, toggle reactions, and subscribe to messages
  and reactions. Threads can expand inline or in a panel.
- **Implementation tasks.** Keep the core as parity; add desktop-quality history
  paging/virtualization, rich composer/markdown affordances, drafts, message
  pin/bookmark/schedule/diff, copy/deep-link, and media in later slices. Do not
  regress the exact-reaction deletion lookup used for a quick second click.
- **Cache/realtime.** De-duplicate by event id; sort `(created_at,id)`;
  reconcile edit/delete commands into every channel/thread cache; requery
  target reactions on uncertain optimistic removal. Subscribe per channel and
  per visible target set; avoid a global unbounded reaction subscription.
- **Security/authorization.** Render untrusted Markdown safely; preserve relay
  author/channel checks for edit/delete and reaction target checks. Never let a
  `p` tag substitute for channel membership.
- **Tests/dependencies.** Existing
  `web/tests/e2e/workspace-threads.spec.ts` and
  `workspace-reactions.spec.ts` are baseline. Add depth-two reply, late edit,
  deletion fan-out, reconnect catch-up, and historical pagination tests.
  **P1 / M.**

### 4. Inbox, Alerts, unread state, and foreground browser notifications

- **Canonical contract.** Inbox accepts only pending workflow approval request
  `46010` with `p=<viewer>`. Mentions/replies are Alerts; ordinary chat stays
  in its channel. Per-event Inbox dismissal and channel/thread/message read
  positions are encrypted self-owned `30078` NIP-RS state (`d` slot and
  `t=read-state`); source messages are never deleted or marked read globally.
- **Desktop writer/read.** Desktop Home/Alerts use
  `desktop/src/features/home/`, the message commands, and local notification
  preferences. The cross-client semantics are documented in
  `docs/agent-surface-map.md`.
- **Web current state.** `workspace-read-state.ts` merges local and decrypted
  remote markers, derives unread channels and Inbox/Alerts, and publishes
  debounced markers. `WorkspaceInbox.tsx` drives the two lists. `WorkspacePage`
  emits a browser `Notification` only while the app is open and hidden.
- **Implementation tasks.** Keep the current decision-queue rule. Add alert
  filtering/grouping and desktop-level per-channel mute/high-priority controls
  in the advanced channel preferences slice; background notification is a
  separate architecture item.
- **Cache/realtime.** Subscribe to own `30078`, current channels, and
  recipient-scoped inbox source kinds; merge monotonically by context timestamp.
  Do not seed a first web visit as unread history. Reset markers when identity
  or relay changes.
- **Security/authorization.** NIP-44 decryption failures must fail locally and
  leave local markers usable. Do not accept prose, `46011`, or `46012` as
  Inbox work. Notifications must avoid exposing private content on a locked
  device when a later background mode is designed.
- **Tests/dependencies.** Existing `workspace-inbox-policy.test.mjs` and
  workspace E2E establish the contract. Add cross-device merge, dismiss vs
  source-read separation, NIP-07-no-NIP44 fallback, and hidden-tab notification
  tests. **P1 / M.**

### 5. Hosted-agent discovery, presentation, and mention delivery

- **Canonical contract.** Hosted directory heads are agent-authored `10100`;
  public hosted presentation/config is the target `30180` coordinate (during a
  short migration, only explicitly recognized legacy data). Names/avatar/model
  obey the precedence in `docs/agent-surface-map.md`. Channel invocation adds
  a permitted agent via `9000` role `bot`, then sends its `p` tag in the channel
  message. The pubkey, not a display name, is the join key.
- **Desktop writer/read.** Desktop's hosted/managed projection logic is in
  `desktop/src/features/agents/`; the agent surface map names all affected
  caches and consumers.
- **Web current state.** `listAgents`,
  `workspace-agent-directory-policy.ts`, `WorkspaceAgents.tsx`,
  `WorkspaceSidebar.tsx`, and `useAgentMentionDelivery.ts` resolve hosted
  directory records, authorized config overlay, access tier, auto-add, and
  mention delivery. Existing E2E tests cover private/shared admission and
  presentation.
- **Implementation tasks.** Complete the `30180` migration and implement hosted
  config editing (name/avatar/desired model) after it; propagate the change to
  roster, mentions, profile, timelines, Inbox, and search. Browser UI must not
  advertise managed-local controls as hosted controls.
- **Cache/realtime.** Refetch/subscribe `['workspace-agents', viewer]` after
  directory/config events; invalidate profile batch caches and member
  presentation when a config changes; refresh channels after auto-add.
- **Security/authorization.** Only the declared agent owner or a community
  owner/admin may publish the public config; select newest authorized head.
  Never expose private managed `30179` aggregates or model secrets. Enforce the
  access/audience policy before suggesting or adding an agent.
- **Tests/dependencies.** Keep all web agent-directory policy and E2E tests;
  add `30180` migration, unauthorized overlay rejection, live config update,
  model-switch observer visibility, and no-private-aggregate leak tests.
  Depends on the P0 kind migration. **P0 / M.**

### 6. Browser repository browsing

- **Canonical contract.** Repository announcement/state is NIP-34 `30617` and
  `30618`; git bytes use the relay's authenticated smart-HTTP endpoints. Read
  authorization is server-side git policy derived from the repository's own
  channel binding, never from a project container.
- **Desktop writer/read.** Desktop projects use native git commands/local
  clones through `projectGit.ts` and Tauri commands; project UI additionally
  renders NIP-34 work items.
- **Web current state.** `/repos` reads NIP-34 heads and
  `web/src/features/repos/git-client.ts` clones/fetches shallow repos into
  LightningFS/IndexedDB with a NIP-98 auth header. It renders tree, README,
  commits, blobs, safe raster previews, and sandboxed HTML behavior. Its
  loading, empty, error, and populated states use the same tokenized
  Workspace/Repositories/Projects navigation shell as the project collection;
  desktop/CLI-only publishing is labelled rather than presented as a browser
  action.
- **Implementation tasks.** Preserve this as the web foundation. Project grouping,
  issues/PRs, and write operations are scoped separately below; do not replace
  the existing safe byte caps or SVG treatment.
- **Cache/realtime.** Cache clone state by relay/owner/repository/ref. Invalidate
  ref/tree/log caches on a newer `30618` head and dispose object URLs after
  blob rendering.
- **Security/authorization.** Keep NIP-98 request URL/method binding, same-origin
  relay selection, binary/text/image size caps, and no active SVG rendering.
- **Tests/dependencies.** Retain `web/tests/buzz-download.test.ts` and repo
  E2E, including empty and populated shell/navigation coverage; add
  private-repo denial, ref-state update, malicious HTML/SVG, and cache
  isolation tests. **P1 / M.**

## Directly portable in browser

### 7. Profiles, user status, and people surfaces

- **Canonical contract.** Kind `0` owns human compatibility profile data;
  `30315` is parameterized-replaceable user status (`d` identifies a status).
  Hosted and managed agent presentation still follows the agent surface map,
  not a profile-only overwrite.
- **Desktop writer/read.** `desktop/src/features/profile/` publishes profile
  changes and projects profile data; `user-status/` reads/writes status.
- **Web current state.** Delivered in the first direct-portable package:
  `/profiles/$pubkey` is an identity-gated, URL-addressable profile page with
  kind `0` edit (read/merge/write), status set/clear, current-status display,
  and browser navigation from the sidebar. `profile-policy.ts` preserves all
  unrelated valid JSON fields; empty `about`/`picture` deliberately clears only
  those browser-owned fields. The page resolves `listAgents` first, so hosted
  or managed presentation continues to win over a human kind `0` fallback.
- **Implementation tasks.** Delivered current-status projection beside every
  rendered historical channel/thread author row. Still add it to member lists,
  Inbox, Alerts, search result cards, and forum/project renderers. Keep agent
  pages read-only here: agent presentation must remain an agent-control write
  flow. Add aliases, richer validation, and an in-workspace profile panel only
  if it reuses this route/cache boundary.
- **Cache/realtime.** `useProfileDetail` queries and subscribes separately to
  kind `0` and kind `30315` with `#d=[general]`, stores the newest head, updates
  its own profile/status cache, and invalidates `workspace-profiles` and
  `user-status` consumer families. `WorkspacePage` adds bounded batch status
  reads/subscriptions for all rendered author pubkeys, refetches canonical
  `listProfiles` on kind `0`, and re-projects historical rows without letting
  a status cache overwrite the hosted-agent presentation overlay.
- **Security/authorization.** Only author writes their `0`/`30315`; validate
  JSON and status tag cardinality; never let a hostile profile override hosted
  agent authorized config.
- **Tests/dependencies.** Delivered unit coverage for malformed/merged kind `0`
  content and replaceable-head ordering, plus browser E2E for profile JSON
  preservation, live desktop-status projection on a historical message,
  set/clear, and hosted-agent precedence. Still require member projection and
  cross-client reconnect E2E. Depends on the shared presentation policy.
  **P1 / M, partial.**

### 8. Global search and navigation to results

- **Canonical contract.** NIP-50 `search` filters go through the existing
  generic query bridge and Postgres FTS. Queries must include explicit kinds;
  the relay re-authorizes every candidate result. Channel filtering uses `h`.
- **Desktop writer/read.** `desktop/src/features/search/hooks.ts` delegates to
  the Tauri relay client; result routing is in `app/navigation/`.
- **Web current state.** Delivered `/search`, linked from the sidebar and
  profile route. It sends an explicit-kind, bounded NIP-50 query for message
  (`9`, `40002`), forum (`45001`, `45003`), repository/project (`30617`,
  `30621`), and Git work-item (`1617`, `1618`, `1619`, `1621`) events. The form validates query
  length, a full hexadecimal author pubkey, channel `h`, and after/before time
  bounds before a relay query. Results link to the author profile and preserve
  channel/thread, forum-channel, or existing repository destination metadata.
- **Implementation tasks.** Delivered root-route consumption of `channel` and
  `thread` URL parameters, including opening the current channel thread from a
  search hit. Forum navigation is delegated to the forum route package; add a
  browser project detail route before claiming full project navigation.
  Add searchable people/agent result cards only through the canonical
  presentation resolver, not raw kind `0` data.
- **Cache/realtime.** The React Query key includes the complete normalized
  filter object and result cache is bounded to 50 events. Search does not keep
  a broad all-events cache. Local writers may invalidate the exact
  `workspace-search` family when their indexed content becomes visible; relay
  reconnection/retry comes from the shared query client.
- **Security/authorization.** Never use open-ended kindless search. Treat
  results as untrusted and rely on relay reauthorization; author-only and
  viewer-private kinds remain unavailable even by known id.
- **Tests/dependencies.** Delivered policy tests for explicit kind/filter
  building, invalid date/author rejection, and route construction; browser E2E
  asserts the actual WebSocket filter and thread deep link. Still require
  private-channel non-leak against a real relay, exact forum/project routing,
  pagination, and reconnect E2E. Depends on query bridge/NIP-50.
  **P1 / M, partial.**

### 9. Advanced channel state: drafts, mute/star/pin/bookmark, scheduling, and templates

- **Canonical contract.** Channel mute and star state uses encrypted NIP-78
  `30078` heads with exact `d`/`t` values `channel-mutes` and `channel-stars`;
  the payload is `{version:1,channels:{id:{muted|starred,updatedAt}}}`. Pins
  (`10001`) and bookmarks (`10003`) are profile-level NIP-51 `e` lists and
  must never acquire a channel `h` tag. Existing stream extensions are `40004`
  pinned, `40005` bookmarked, `40006` scheduled, `40007` reminder, and `40008`
  diff; these are not substitutes for the user lists.
- **Desktop writer/read.** `desktop/src/features/messages/`, `sidebar/`,
  `channel-templates/`, and drafts implementation combine relay events with
  scoped local preferences.
- **Web current state.** `/channel-state?channel=&thread=` provides
  relay/identity/channel/thread-scoped local draft management plus live,
  encrypted mute/star state. Workspace stream and thread composers, plus forum
  post/comment composers, restore and save those local text drafts. Existing
  sidebar favourite controls and the active-channel mute control use the same
  live relay state; forum posts expose profile-level pin/bookmark actions.
- **Implementation tasks.** The browser mutes path stores a durable outbox,
  merges the relay head before publish, and uses a timestamp strictly newer
  than the observed head, matching desktop's NIP-33 safety rule. Templates,
  stream pin/bookmark actions, and scheduled send remain absent: no browser
  writer is added until their server execution/relay semantics are established.
- **Cache/realtime.** Exact author/`d` subscriptions update mute/star heads;
  draft updates are local only. Mute/star outboxes and draft/star storage are
  scoped by relay URL and pubkey; a failed publication is retried on the next
  workspace or channel-state mount rather than discarded.
- **Security/authorization.** Encrypt personal state when the existing NIP-RS
  contract requires it; do not infer permission from a pinned message. Scheduled
  send needs server-side execution semantics before promising delivery while the
  tab is closed.
- **Tests/dependencies.** Policy tests cover strict payload decoding,
  relay/identity scope, NIP-51 no-`h` writes, low-id same-second heads, and
  monotonic NIP-33 publication. Templates, scheduling, and real relay
  two-client E2E remain outstanding. **P2 / M, partial.**

### 10. Pulse activity feed

- **Canonical contract.** Pulse is a client projection over authored notes,
  replies, agent activity/observer events, project comments, message/thread
  events, and current profiles. It has no independent Pulse event kind.
- **Desktop writer/read.** `desktop/src/features/pulse/` filters/projects
  relay event queries and applies note actions.
- **Web current state.** Implemented at `/pulse`: bounded channel-visible
  message/forum projection with All, Messages, Forums, and Agents filters.
- **Implementation tasks.** Ported the pure grouping/reply/project-comment
  helpers and added reply navigation. Observer-frame telemetry remains excluded
  because a browser must not infer ownership from a `p` tag.
- **Cache/realtime.** Uses explicit-kind cursor pages and `#h` subscriptions;
  live events merge into the first page immediately. Rendered author profiles
  use one shared batch cache and kind `0` invalidation subscription.
  **Known limitation:** browser REQ supports only an inclusive timestamp cursor,
  not the relay's `(created_at, id)` keyset cursor, so an unusually dense
  same-second page boundary can repeat or defer rows; it is not claimed as
  lossless keyset pagination.
- **Security/authorization.** Query only explicit public/readable kinds and
  preserve the encrypted observer-frame ownership restriction. Do not reveal
  agent telemetry merely because an event contains a familiar `p` tag.
- **Tests/dependencies.** Port desktop `groupAgentNotes`, note-actions, replies,
  and project-comment tests; add browser E2E for pagination and profile updates.
  Depends on people/presentation and event-query utilities. **P2 / M.**

### 11. Forums and post threads

- **Canonical contract.** Forum post `45001`, vote `45002`, and comment `45003`
  are channel-scoped and require `h`. Reply targeting uses `e`; reaction/delete
  behavior follows the same relay authorization as channel content.
- **Desktop writer/read.** `desktop/src/features/forum/` and
  `shared/api/forum.ts` provide composer, post cards, voting, comments, and
  deletion UI; messages command code fetches posts/threads.
- **Web current state.** Implemented at `/channels/$channelId/posts` and
  `/channels/$channelId/posts/$postId`, including URL-targeted search results.
- **Implementation tasks.** Post cursor paging, Markdown composer, comments,
  `45002` vote aggregation, author delete, and thread deep links are present.
  Browser writers always include `h`; the relay remains the membership authority.
- **Cache/realtime.** Cache by channel/post; subscribes to `45001`–`45003` and
  channel deletion kinds with `#h`, immediately requerying post/thread
  projections on each live update.
  **Known limitation:** post paging uses the Nostr inclusive timestamp cursor,
  so it cannot yet exactly reproduce the relay's `(created_at, id)` keyset
  behavior at an unusually dense same-second boundary.
- **Security/authorization.** Enforce `h` on every writer and relay membership
  errors; validate vote target/kind/client-side for UX but trust relay. Sanitize
  Markdown and attachments.
- **Tests/dependencies.** Port forum hook/unit tests; E2E create/comment/vote,
  unauthorized channel, edit/delete reconciliation, and post deep-link. **P1 / L.**

### 12. Custom emoji

- **Canonical contract.** User emoji list `10030` and parameterized emoji set
  `30030` are latest-per-author/per-`d` heads. The workspace palette is a
  read-time union of member-authored sets; custom reaction uses kind `7` with
  the required emoji metadata/tag semantics.
- **Desktop writer/read.** `desktop/src/features/custom-emoji/` and
  `shared/api/customEmoji.ts` fetch/publish palette sets and route custom
  reaction creation through the message command.
- **Web current state.** Delivered feature-local set management and palettes in
  workspace and forum composers. The browser reads member-authored `10030` and
  the exact `30030:d=buzz:custom-emoji` heads, deduplicates the deterministic
  palette, and writes canonical parameterized sets. Composer inserts create
  self-contained NIP-30 `emoji` tags; workspace kind-`7` reactions carry the
  same metadata and render it. Message and forum Markdown only resolve URLs
  carried by the signed event, not a mutable palette lookup.
- **Implementation tasks.** Delivered picker insertion, own-set add/remove,
  workspace custom reactions, protected current-relay image fetches with object
  URL cleanup, and forum post/comment composer reuse. Forum currently has
  `45002` vote semantics rather than a generic kind-`7` reaction contract, so
  custom reactions are deliberately not advertised there. Set management uses
  existing safe image URLs; browser-side image uploading for emoji assets is
  not added separately.
- **Cache/realtime.** Initial explicit-kind reads and parallel `10030`/`30030`
  subscriptions invalidate the member-scoped palette on live relay events. Own
  set mutation invalidates both own and visible palette queries. Rendering caps
  untrusted lists/palettes and fetches authenticated relay media only through
  the browser media adapter.
- **Security/authorization.** Validate shortcode/url/tag cardinality, reject
  script/data URLs and SVGs, and reject ambiguous reaction metadata. Membership
  and author authorization remain relay enforced; the browser only presents
  signed self-contained media metadata.
- **Tests/dependencies.** Unit coverage includes deterministic latest heads,
  unsafe URL/duplicate-coordinate rejection, self-contained writes, ambiguous
  reactions, and strict reminder target validation. Browser E2E covers own-set
  creation plus composer and reaction tag publication. Deleted-set and real
  relay multi-client reconciliation remain outstanding. Depends on the browser
  media adapter. **P2 / M, partial.**

### 13. Moderation, reports, restrictions, and audit views

- **Canonical contract.** Reports are `1984`; moderation command kinds are
  `9040` ban, `9041` unban, `9042` timeout, `9043` untimeout, and `9044`
  resolve. Relay audit is kind `48001`/audit storage. The relay validates role,
  target, scope, duration, and produces restrictions; UI permissions are only a
  convenience.
- **Desktop writer/read.** `desktop/src/features/moderation/`,
  `shared/api/moderation.ts`, and Settings moderation queue call the Tauri relay
  client and display report/audit/restriction state.
- **Web current state.** `/moderation` submits exact `1984` event reports and
  provides owner/admin queue, restriction, audit, resolve, and lift controls.
  Reads use the existing NIP-98-authorized `/moderation/reports`, `/audit`, and
  `/restricted` endpoints; command writes are `9040`–`9044` with no `h` tag.
- **Implementation tasks.** The current report entry is an explicit target-id
  form, not yet an inline message/post dialog; timeout creation and a member
  restriction banner are still pending.
- **Cache/realtime.** Successful moderation commands invalidate all three
  query families. Reports and direct commands are intentionally not relay WS
  fan-out events, so the route refreshes the relay-authorized views on a bounded
  15-second interval rather than pretending an unavailable subscription exists.
- **Security/authorization.** Do not expose report contents to unauthorized
  users; disable controls only as UX, surface relay rejection, protect timeout
  duration parsing, and preserve immutable audit semantics.
- **Tests/dependencies.** Port restriction/timeout pure tests; E2E member vs
  admin/owner authorization, report privacy, restriction expiry, and audit
  refresh. **P1 / L.**

### 14. Identity archive presentation and action

- **Canonical contract.** Archive/unarchive requests are `9035`/`9036`; relay
  publishes the authoritative signed `13535` archive snapshot. A self, relay
  admin/owner, or verified NIP-OA owner may request the change; archive is
  relay-scoped presentation/discovery state, not NIP-43 membership removal.
- **Desktop writer/read.** `identity-archive/` and
  `tauriIdentityArchive.ts` query the snapshot, verify possible ownership, and
  publish the request.
- **Web current state.** `/identity-archive` presents only verified,
  relay-signed `13535` snapshots and lets the identity itself or a community
  owner/admin submit protected `9035`/`9036` requests. It explains explicitly
  that archive is not a ban or membership removal and labels the caller's own
  archived record rather than hiding it.
- **Implementation tasks.** The browser deliberately does not manufacture the
  NIP-OA owner authorization tag, so that owner path remains desktop-only.
  Profile flair and discovery folding are not wired into concurrently-owned
  shared profile/member/DM surfaces yet; the feature-local self-exempt predicate
  is tested and ready for that integration.
- **Cache/realtime.** The reader obtains the relay signer from NIP-11, verifies
  every `13535` signature and exact protected-tag shape, then subscribes only to
  that signer and updates `['archived-identities']` immediately.
- **Security/authorization.** Verify relay signer/tenant, never hide self,
  never conflate archive with banned/removed membership, and rely on the relay
  for NIP-OA/admin authority.
- **Tests/dependencies.** Port identity archive predicate/action tests; add
  browser E2E self archive/unarchive, unauthorized action, tenant isolation,
  and stale snapshot recovery. **P2 / M.**

### 15. Project collection, issue/PR work items, and activity

- **Canonical contract.** A project is addressable `30621` keyed by `(pubkey,
  kind, d)`, with `a=30617:<owner>:<repo-d>` members, optional
  `buzz-channel`, and `buzz-visibility`. Repository state is `30617`/`30618`;
  issues/patches/PRs/statuses are NIP-34 kinds (`1621`, `1617`–`1619`,
  `1630`–`1633`) and comments use kind `1` with repository `a`, root `e`, and
  recipients `p` until the relay registers NIP-22. Projects grant no git or
  channel authority.
- **Desktop writer/read.** `desktop/src/features/projects/` includes exhaustive
  project enumeration/fold, card/list views, issues, PR review/comments,
  activity, native snapshots/diffs, and local terminal launch.
- **Web current state.** Delivered as a read-only browser slice: `/projects`,
  `/projects/$projectAddress`, `/repos/$repositoryAddress/work-items`, and
  `/repos/$repositoryAddress/work-items/$workItemId` project the current NIP-MP
  collection, project members, implicit repositories, issues, PRs, patches,
  updates, status, comments, review decisions, and activity. Route addresses
  are canonical full coordinates, never ambiguous repository `d` values.
- **Implementation tasks.** `project-policy.ts` strictly parses NIP-MP members,
  NIP-34 repository/work-item edges, and trusted lifecycle/review actors;
  `project-api.ts` performs explicit-kind, `a`-scoped reads. The browser keeps
  list/detail/navigation read-only. Still port the shared NIP-MP fixture corpus,
  rich inline diff/review presentation, and any remote Git viewer enhancement;
  local checkout, terminal, commit, merge, and push remain out of scope.
- **Cache/realtime.** `['projects','collection']` paginates `30621` and `30617`,
  folds scoped kind `5` deletions, and subscribes to replacement heads plus the
  observed coordinates. `['projects','detail', projectAddress]` uses the same
  safe fold. `['projects','work-items', repositoryAddress]` uses one exact
  `#a` subscription across explicit `1617`–`1619`, `1621`, `1630`–`1633`, and
  kind `1` events. A saturated timestamp bucket reports `possiblyIncomplete`
  rather than silently pretending the history is complete.
- **Security/authorization.** Preserve NIP-MP claim authority: a project cannot
  grant push/read access or make a foreign repository look endorsed. Resolve
  each repository coordinate explicitly; validate `a` coordinates and retain
  owner provenance. Git policy still reads the repository's own binding.
- **Tests/dependencies.** Delivered policy regressions cover duplicate/mixed-case
  coordinates, foreign claims, NIP-01 equal-timestamp lowest-id heads, owner
  deletion, exact work-item edges, and untrusted lifecycle input. Browser E2E
  covers collection, work-item and project deep links. Still add the shared
  NIP-MP fixture corpus, saturated-page real-relay pagination, unavailable
  members, PR review variants, and protected-repo denial. Depends on the
  existing repository browser. **P1 / L, read-only delivered.**

## Portable through existing relay events

### 16. Direct messages and per-viewer DM visibility

- **Canonical contract.** DM commands are `41010` open/re-open, `41011` add
  member, `41012` hide. Membership remains `39002`; hide is *not* removal. The
  relay emits private signed `30622` with exactly `d=<viewer>`, `p=<viewer>`,
  and an `h` set of hidden DM channels; read access is owner-only.
- **Desktop writer/read.** Desktop DM/new-message surfaces and channel commands
  use the command executor and consume the relay visibility projection.
- **Web current state.** The sidebar can render DM-typed channels discovered
  from `39000`/`39002`, but web cannot compose/open a DM, invite a DM member,
  hide/reopen, or filter by `30622`.
- **Implementation tasks.** Add a new-message/DM composer and recipient search,
  publish the three command kinds, query only own `#p` snapshot, filter hidden
  DMs, and give a visible reopen path. Make DM permalink/thread navigation
  URL-addressable.
- **Cache/realtime.** Invalidate channel/membership projection after command;
  subscribe to own `30622` and replace the full hidden set atomically. Requery
  recipient/channel profile data after an open/add succeeds.
- **Security/authorization.** `30622` must be queried with own `#p`, validated
  against the relay identity, and never cached across accounts. Do not infer
  hidden state from missing membership or allow a viewer to read another
  viewer's hide set.
- **Tests/dependencies.** Relay command integration tests plus web E2E open,
  hide, reload, re-open, unauthorized snapshot query, and group DM member
  permissions. Depends on snapshot verification. **P1 / L.**
- **Implementation status (web, 2026-08).** `/messages/new` and
  `/messages/$channelId` now provide the browser flow. The client publishes the
  three commands, validates only its own `#p`-scoped `30622` snapshot before
  atomically filtering the sidebar, and offers hidden-DM re-open/add-member
  controls. Focused policy coverage rejects foreign or malformed snapshots.

### 17. Presence and typing indicators

- **Canonical contract.** Presence `20001` and typing `20002` are ephemeral;
  Redis provides cross-node fan-out/presence TTL. They are hints, not durable
  profile or membership data, and typing has no REST query endpoint.
- **Desktop writer/read.** `desktop/src/features/presence/` and chat composer
  use relay subscriptions plus desktop idle information.
- **Web current state.** No presence/typing presentation or emission.
- **Implementation tasks.** Add WebSocket subscriptions and debounced typing
  publisher per active channel, presence badges with expiry, and browser
  visibility/idle-to-away adapter. Degrade silently when disconnected.
- **Cache/realtime.** Keep ephemeral maps outside long-lived React Query cache;
  expire by server/client TTL and clear on community switch/reconnect. Never
  persist typing state to IndexedDB.
- **Security/authorization.** Treat events as advisory and scoped by relay;
  verify channel membership through relay delivery, rate-limit client emission,
  and do not use presence to bypass archived/banned visibility policy.
- **Tests/dependencies.** Unit-test debounce/TTL/visibility transitions; E2E
  two-browser typing and reconnect/expiry. Depends on reliable WS subscription
  lifecycle. **P2 / M.**
- **Implementation status (web, 2026-08).** Browser presence now publishes
  online/away/offline state on visibility and idle transitions with a heartbeat;
  presence and typing use bounded local TTL maps, live subscriptions, reconnect
  refresh/clear behavior, and never enter the durable query cache.

### 18. Workflows, run traces, approvals, and webhooks

- **Canonical contract.** Workflow definitions are channel-scoped addressable
  `30620` (`d` workflow id, `h` channel, YAML content). Commands are `46020`
  trigger, `46030` grant, and `46031` deny; approval actions carry the stored
  SHA-256 token hash in `d`. NIP-09 kind `5` deletes the owner coordinate. The
  relay command executor validates, persists, and invokes `buzz-workflow`.
  Webhooks remain the existing server-only `/hooks/{id}` surface with stored
  secret handling.
- **Desktop writer/read.** `desktop/src/features/workflows/`,
  `tauriWorkflows.ts`, and Tauri command wrappers manage YAML, runs, and
  approvals.
- **Web current state.** `/workflows` and `/workflows/$workflowId` list
  channel definitions, create/edit/delete owner definitions, toggle the portable
  YAML `enabled` flag, submit manual runs, and action any relay-delivered
  approval request. The visual editor is a typed **linear** flow that compiles
  to the existing YAML contract: web-search choices require a runtime-published
  web resource and library-tool choices come from that agent's published
  resource catalog. It remembers the most recently selected workflow channel
  per identity and otherwise follows the active workspace channel, rather than
  selecting an arbitrary catalog entry. The editor uses a strict browser schema
  parser; it rejects malformed, duplicate-coordinate, or non-canonical-author
  event envelopes. A webhook secret is shown only from the accepted event
  acknowledgement and is never placed in URL, storage, or analytics.
- **Remaining implementation limits.** The relay currently stores run history
  only in `workflow_runs`; it does not emit `46001`–`46007`, so the browser
  truthfully renders an unavailable trace rather than using a new endpoint.
  Approval gates still terminate at `WF-08` and do not emit `46010` end-to-end;
  the UI can act only on a valid request that a relay does deliver. The relay has
  no Nostr command for its separate durable `workflows.enabled` lifecycle flag:
  a YAML `enabled: false` replacement disables automatic matching, while current
  manual trigger behavior remains server-controlled. Desktop Tauri run-history
  projection and local CLI/YAML-file affordances therefore remain desktop-only.
  Buzz Web therefore disables the approval node and refuses to publish a YAML
  replacement containing `request_approval`; it continues to parse those
  historical definitions read-only. A true n8n-style graph (branching, joins,
  parallel paths, and typed edges) is intentionally out of scope until the
  canonical relay schema adds graph topology rather than overloading step order.
- **Cache/realtime.** `['workflow-channel', channel]`,
  `['workflow-detail', id]`, `['workflow-trace', id]`, and
  `['workflow-approvals', viewer]` use explicit-kind queries and live
  subscriptions. Definition, trace, and approval signals invalidate their
  matching cache; replacement heads use timestamp then lowest event id.
- **Security/authorization.** The relay must remain the workflow executor,
  approval-token authority, SSRF protector, and secret store. Browser must
  surface current limitations: approval continuation is not end-to-end wired,
  and `send_dm`/`set_channel_topic` actions are currently stubbed. Do not claim
  they work until relay behavior changes.
- **Tests/dependencies.** Web policy regressions cover strict YAML,
  lowest-id replacement, malformed coordinates, and misdirected approvals; E2E
  covers definition write/toggle, trigger, and approval events. Full desktop
  parity still depends on relay trace emission and approval-gate completion.
  **P1 / M (browser event surface complete where supported).**

### 19. Encrypted reminders and reminder management

- **Canonical contract.** A reminder is author-only addressable `30300` with a
  random `d`, NIP-44 self-encrypted content, and public `not_before` only while
  pending. Done/cancelled are replacements without `not_before`; NIP-09 can
  hard-delete. The relay may redeliver a due event but clients must enforce due
  time and de-duplicate by address/id.
- **Desktop writer/read.** `desktop/src/features/reminders/` and
  `reminderService.ts` build/decrypt/snooze/complete/cancel and display a route
  plus local notification behavior.
- **Web current state.** No reminder route, queries, or lifecycle UI.
- **Implementation tasks.** Port the reminder codec/validation, use browser
  NIP-44 self encryption, add `/reminders`, create from a message/post or note,
  snooze/complete/cancel, recovery pagination, and deep-link target navigation.
  Foreground notification can use the browser adapter; closed-tab delivery is
  separately scoped under push architecture.
- **Cache/realtime.** Query/subscribe only the current author's `30300`; keep
  latest head per `(pubkey,d)`, discard early signals locally, and reschedule on
  replacement. Persist only encrypted/necessary metadata according to NIP-ER.
- **Security/authorization.** Never query another author's reminders; validate
  one `d` and valid `not_before`; do not leak note/target to logs or notification
  previews; fail safe if NIP-44 is unavailable.
- **Tests/dependencies.** Port reminder service/filter/navigation/time tests;
  browser E2E create/snooze/complete/reload and early/duplicate due signal. Uses
  existing browser signer. **P1 / M.**
- **Implementation status (web, 2026-08).** `/reminders` creates encrypted
  note reminders and supports snooze, complete, and cancel. The browser queries
  and subscribes only as the current author, materializes the newest coordinate
  per `d`, validates the public envelope plus decrypted content, and does not
  follow unsafe target links.

### 20. Huddle lifecycle, participant history, and guidelines

- **Canonical contract.** Huddle state is channel-scoped: `48100` started,
  `48101` joined, `48102` left, `48103` ended, `48106` guidelines, and `24810`
  huddle reaction. Audio itself is a separate authenticated huddle WebSocket
  endpoint and is scoped in the next section.
- **Desktop writer/read.** `desktop/src/features/huddle/` records lifecycle,
  participant list, transcript/attachments, agent involvement, and huddle UI.
- **Web current state.** `/huddles/$channelId` verifies that the current browser
  identity can see the parent channel, queries and subscribes to its lifecycle
  kinds by `h`, validates the canonical ephemeral UUID in signed content, and
  folds deterministic participant history. It creates the desktop-compatible
  private, one-hour backing channel (`9007`), writes best-effort `48106`
  guidelines, then publishes `48100`; visible lifecycle creation and audio join
  remain separate user actions. The page reads/writes the newest guidelines for
  each backing channel.
- **Remaining implementation tasks.** Add a compact huddle card in the primary
  channel timeline/sidebar, `24810` huddle-reaction controls, and a richer
  participant/profile presentation. Keep transcript/agent voice controls tied
  to a future browser-safe speech contract.
- **Cache/realtime.** Query per parent `h`; fold exact event ids with
  `(created_at ASC, id ASC)` history order, clear participants when ended, and
  invalidate/requery after an interrupted lifecycle subscription reconnects.
- **Security/authorization.** Channel membership gates writes and admission;
  do not treat a historical join event as live audio authorization. Recording
  and per-track publishing remain unimplemented server capabilities.
- **Tests/dependencies.** Browser lifecycle fold/UUID/tie-break unit tests and
  mocked relay E2E cover the current reader. A two-client start/join/leave/end
  relay E2E remains required. **P2 / M.**
- **Implementation status (web, 2026-08).** Lifecycle history, guidelines, and
  the URL-addressable browser huddle route are implemented without a bespoke
  HTTP API.

## Portable with browser APIs/adapters

### 21. Media attachments, gallery, image drawing, video, and downloads

- **Canonical contract.** Media bytes use Blossom `/media/upload` and
  `/media/{sha256_ext}` with BUD-01/BUD-11/NIP-98-style authorization. Message,
  forum, and project-comment events carry standard file/media metadata/tags;
  relay media access remains content-addressed and authorized.
- **Desktop writer/read.** `desktop/src/features/messages/` plus native media
  commands support file/image/video/GIF attachment, drawing, transcode, gallery,
  download, and authenticated retrieval.
- **Web current state.** Workspace chat now supports browser file picker,
  drag/drop, clipboard files, BUD-02 upload with WebCrypto SHA-256 and signed
  kind `24242` authorization, NIP-92 `imeta` metadata, authenticated image and
  MP4 previews/lightbox, generic-file downloads, upload progress/retry, and
  object-URL cleanup. Active SVG/HTML/script content is rejected before upload;
  media is rendered only after a same-relay URL check and protected fetch.
- **Remaining implementation tasks.** Add browser-safe image drawing/crop,
  audio preview, codec capability reporting, and media attachment reuse in the
  forum/project composers. Camera capture, OS reveal, and the desktop drawing
  editor remain native-only unless a browser-safe shared contract is added.
- **Cache/realtime.** Cache immutable media by hash, not signed URL; refresh
  authorization headers on protected fetch, revoke object URLs, and invalidate
  message/forum/project caches after the event publish succeeds.
- **Security/authorization.** Validate content type/size locally and rely on
  relay validation; never trust filename or render active SVG/HTML inline;
  avoid leaking a signed auth header to cross-origin URLs; preserve media ACL on
  download and share flows.
- **Tests/dependencies.** Browser unit tests for hash/tag/auth construction and
  object URL cleanup; E2E image/file/video upload, protected download, failed
  upload, retry, and malicious MIME/SVG. Depends on relay CORS behavior and
  existing Blossom endpoints. **P1 / L.**

### 22. Browser huddle audio and optional transcription/TTS

- **Canonical contract.** The relay endpoint is
  `wss://<relay>/huddle/<channel-id>/audio`; it performs NIP-42 auth and channel
  membership admission, then relays opaque Opus frames with the documented v2
  header. Lifecycle kinds remain the source of collaboration state.
- **Desktop writer/read.** Huddle uses an AudioWorklet, device chooser,
  push-to-talk, speaker activity, TTS, and native shell integration.
- **Web current state.** `BrowserHuddleAudio` asks for `getUserMedia` only after
  the user clicks Join audio, enumerates browser-safe input devices, signs the
  existing NIP-42 challenge, and exchanges v2 Opus frames through WebCodecs and
  Web Audio. It maps capture-time levels to asynchronous encoder timestamps,
  keeps a bounded 50ms playout lead, mutes capture while hidden, and stops
  tracks/closes the decoder, encoder, context, and socket on leave or unmount.
  Browsers without secure context, microphone APIs, or Opus WebCodecs display a
  capability message instead of opening a raw socket.
- **Remaining implementation tasks.** Provide a compatible WASM Opus fallback
  for browsers without WebCodecs, push-to-talk/active-speaker UI, output-device
  routing where `setSinkId` is available, and a browser interoperability matrix.
  Transcription and TTS remain unavailable: the current implementations require
  desktop-native pipelines and no browser-safe server contract is authorized.
- **Cache/realtime.** Keep audio buffers and capture state out of React Query;
  bind a transport to one huddle/channel/identity, gate its microphone on
  document visibility, and require explicit rejoin after changing a device or a
  failed socket. Lifecycle cards receive independently reconnecting relay
  events and requery after reconnect.
- **Security/authorization.** Require secure context, explicit microphone
  permission, NIP-42, and server membership admission. No recording by default;
  do not expose a raw audio socket or store microphone bytes in browser archive.
- **Tests/dependencies.** Delayed/multi-output frame metadata unit regression
  and mocked-media Playwright join/leave teardown cover the adapter. Relay
  integration with authorized vs unauthorized joins and a manual cross-browser
  codec/interoperability matrix remain required. **P2 / XL.**
- **Implementation status (web, 2026-08).** The gated WebCodecs transport is
  implemented; it does not claim compatibility in browsers lacking that API.

### 23. Local archive, offline cache, and encrypted backups

- **Canonical contract.** Desktop local archive is local SQLite storage and
  save subscriptions over channel `h`, owner `p`, or referenced `e`; it is not
  relay state. Archived observer frames and agent metrics may require
  decryption/indexing. Existing NIP-RS remains the cross-device sync mechanism,
  not an archive database.
- **Desktop writer/read.** `desktop/src/features/local-archive/` and
  `tauriArchive.ts` maintain subscriptions, write encrypted/raw event archive,
  index observer channel ids, and page with compound cursors.
- **Web current state.** `/offline` provides an IndexedDB v1 archive partitioned
  by normalized relay URL and unlocked identity. It accepts only verified,
  ordinary channel events from explicit `h`-scoped reads/subscriptions (kinds
  `5`, `7`, `9`, `40002`, `40003`, `40099`, `9005`), deduplicates event IDs,
  encrypts records with an HKDF-derived non-extractable AES-GCM key, and bounds
  one partition to 10,000 records / 50 MiB. It supports user-initiated clear,
  passphrase-encrypted download/upload, and deterministic `(created_at DESC,
  id ASC)` paging.
- **Cache/realtime.** Archive only starts from an explicit user action. Its
  optional foreground recorder subscribes with an exact kinds + `#h` filter;
  there is no service worker, background fetch, or unscoped cache ingestion.
  Lock removes the page's decrypted query cache; changing identity or relay
  selects a distinct encrypted partition.
- **Security/authorization.** The archive never persists private relay events,
  decrypted agent telemetry, browser private keys, or a decrypted backup.
  Decryption derives a fresh key only while the browser identity is unlocked.
  IndexedDB is still weaker than a native keychain/SQLite archive and remains
  device-local; quota and browser storage eviction can limit it.
- **Tests/dependencies.** Policy coverage asserts strict archive eligibility,
  scope isolation, and same-second cursor ordering. IndexedDB encrypted
  round-trip and offline-reload browser E2E remain environment-dependent
  follow-up coverage. **P2 / L (portable bounded foundation).**

### 24. Browser notifications, device pairing, backup/import, and accessibility settings

- **Canonical contract.** Foreground notifications are client-local; persistent
  delivery will use push lease `30350` and is discussed under new architecture.
  Pairing uses existing NIP-AB pairing relay/CLI protocol; recovery/backup is
  user-owned private key material.
- **Desktop writer/read.** Desktop Settings exposes notification sounds,
  platform permissions, mobile pairing QR, encrypted backup, keyboard
  shortcuts, prevent-sleep, and voice settings.
- **Web current state.** `/preferences` stores relay+identity-scoped browser
  settings for foreground notifications, notification sound, reduced motion,
  font scale, and keyboard help. Permission and audio preview are only invoked
  by clicks; foreground notifications never run a background push worker.
  `/pairing` implements the portable NIP-AB subset: it discovers only the
  NIP-11-advertised pairing relay, uses kind `24134` with an exact recipient
  `p` tag, fresh in-memory ephemeral secp256k1 ECDH, a 120-second session,
  SAS/transcript confirmation, and separate explicit source-send and
  target-import gestures. Only an `nsec` recovery payload is supported.
- **Cache/realtime.** Preferences are local browser state scoped by relay and
  pubkey. Pairing holds no persistent session secrets, keys, ciphertext, or
  payload; completion, cancellation, expiry, and route unmount clear memory.
- **Security/authorization.** Browser pairing deliberately uses raw ECDH for
  NIP-AB SAS derivation rather than a NIP-44 conversation key, validates relay
  URL/version/URI/message shape, and does not auto-import an identity. There is
  no browser filesystem/native keychain/system notification or Wake Lock
  integration. Source devices render the exact one-time URI as an in-page QR
  image. Target devices expose camera scanning only when both `BarcodeDetector`
  and `getUserMedia` are present; scanning is an explicit gesture, never joins
  automatically, stops its tracks after a result/error/route cleanup, and shares
  the two-minute cap. Manual copy/paste remains available on every browser.
  Bunker/remote signer transfer and background push remain unsupported.
- **Tests/dependencies.** Policy coverage asserts strict pairing URI/message
  schemas, constant-time material comparison, camera capability gating, and
  camera-track cleanup after a scan. Browser E2E verifies a source QR is
  rendered and that unsupported browsers keep the manual fallback. **P2 / M
  (portable bounded foundation).**

## Needs new browser-safe/server architecture

### 25. Hosted-agent administration beyond presentation, and managed-agent lifecycle

- **Canonical contract.** Hosted agent discovery/config is public (`10100` +
  target `30180`); managed agent definition/persona projections are `30175`,
  `30177`, team `30176`/`30178`, private managed aggregate `30179`, owner
  attestation NIP-OA, observer frames `24200`, metrics `44200`, and encrypted
  memory `30174`.
- **Desktop writer/read.** Desktop owns managed nsecs, provider discovery,
  harness installation, environment/secrets, local runtime spawn/restart,
  metrics/logs, private aggregate materialization, and persona/team controls in
  `desktop/src/features/agents/` and Tauri commands.
- **Web current state.** Web correctly discovers hosted agents and can invite/
  mention them. It has no managed record, persona/team editor, lifecycle,
  runtime log, model-provider discovery, or observer control UI.
- **Implementation tasks / architecture required.** Split the product explicitly:
  1. browser-safe **hosted administration** may publish/read public `30180` and
     controlled public persona/team data;
  2. a separately authenticated **managed runtime service** must own process
     launch, secret injection, agent keys, lifetime, logs, and policy;
  3. browser control is a short-lived owner-authorized command/projection API
     with audit, rate limits, tenant binding, and no raw nsec/environment return.
  It must not expose Tauri commands over HTTP.
- **Cache/realtime.** Consume public directory/config and owner-scoped,
  encrypted/redacted runtime projections; subscribe to signed observer events
  only after authorization. Invalidate roster/profile/turn state on runtime
  status transition.
- **Security/authorization.** This is P0 because a browser must never receive
  managed secret keys or arbitrary process control. Enforce owner/admin policy,
  authenticated relay tenant, command allowlist, CSRF/origin protections,
  audit trail, bounded log redaction, and strict rate/concurrency limits.
- **Tests/dependencies.** Threat-model review; server integration for owner vs
  non-owner, secret non-disclosure, command replay, tenant isolation, audit,
  and process cleanup; browser E2E uses only redacted projections. Depends on
  the `30180` migration and a new service. **P0 / XL.**

### 26. Browser terminal and project-local git mutation experience

- **Canonical contract.** Project/repository metadata and git smart HTTP exist,
  but desktop native terminal opens an OS terminal at a cloned checkout and
  native git commands execute diff/merge/push workflows.
- **Desktop writer/read.** `project_terminal.rs`, project git commands, and
  `desktop/src/features/terminal/` launch/process/stream a local terminal.
- **Web current state.** The browser can shallow-clone/read with isomorphic-git;
  it cannot open a user's terminal, local path, shell, or native checkout.
- **Implementation tasks / architecture required.** For a browser "terminal" offer a remote workspace
  service with per-user isolated ephemeral workspaces, Git policy mediated by
  the relay, short-lived terminal session tokens, an audited command allowlist
  or full sandbox policy, terminal WebSocket, quotas, egress/SSRF controls,
  artifact cleanup, and explicit user consent. A lower-risk first phase is
  browser-native git editing/commit/push only, using existing git HTTP after a
  CORS/NIP-98 POST/push contract audit.
- **Cache/realtime.** Session state is ephemeral and never belongs in normal
  project cache. On push, wait for authoritative `30618` ref-state then
  invalidate browser clone/ref/tree/log/project activity caches.
- **Security/authorization.** Do not run shell commands on the relay host or
  user machine. Enforce repo channel policy at every fetch/push; never trust a
  project `buzz-channel` as ACL; redact terminal output and isolate tenants.
- **Tests/dependencies.** Security harness for command isolation/cleanup and
  policy denial; browser E2E against a disposable sandbox; git push atomicity
  regression suite. **P1 / XL.**

### 27. Mesh compute and browser-initiated local/remote model serving

- **Canonical contract.** Desktop mesh controls manage a local node with mode,
  model, VRAM, join token, health, endpoint/device identity, and serving usage.
  Agent provider selection can reference relay mesh, but the running node is
  local process/hardware state, not a Nostr event.
- **Desktop writer/read.** `desktop/src/features/mesh-compute/`,
  `tauriMesh.ts`, and Tauri mesh commands inspect GPU/model cache and start/stop
  the serving process.
- **Web current state.** None.
- **Implementation tasks / architecture required.** Define either (a) a managed remote mesh/control
  plane with enrolled device agents and signed capability heartbeats, or (b) a
  constrained WebGPU in-tab inference mode that is explicitly non-equivalent to
  a persistent serving node. Browser pages cannot safely start a background GPU
  daemon, inspect VRAM reliably, or accept network work after close.
- **Cache/realtime.** Device/node status must come from tenant-scoped signed
  heartbeats/projections with TTL; clear stale state; meter usage server-side.
- **Security/authorization.** Do not accept public join tokens in URLs or
  browser storage; require device enrollment, owner/admin policy, workload
  isolation, rate/quota, model provenance, and revocation. Never expose a local
  inference endpoint to the internet from browser code.
- **Tests/dependencies.** New protocol conformance, device enrollment/revoke,
  stale heartbeat, quota, and hostile model tests; browser UI can only be built
  once service contract exists. **P1 / XL.**

### 28. Reliable background notifications and web push leases

- **Canonical contract.** Push lease `30350` stores encrypted endpoint-bearing
  information author-only; effective delivery state is in relay tables. NIP-ER
  relay due signals and foreground WebSocket delivery are not a guarantee when
  the tab/browser is closed.
- **Desktop writer/read.** Desktop uses OS notification APIs, resident process/
  tray behavior, local reminder scheduling, per-slot sound configuration, and
  feed notification state.
- **Web current state.** Foreground-only `Notification` delivery while the
  hidden tab is connected.
- **Implementation tasks / architecture required.** Add a service worker + Web Push subscription flow,
  encrypted lease writer/read path, server-side delivery worker, VAPID/key
  management, endpoint rotation/revocation, payload-minimization policy, user
  notification preferences, and delivery/audit observability. A notification
  click must deep-link through a safe in-app route without embedding sensitive
  message content in the push payload.
- **Cache/realtime.** Service worker, page, and relay lease state need explicit
  version/revocation reconciliation; foreground dedupe uses event id/context so
  a push and live WS event do not double-alert.
- **Security/authorization.** Treat endpoints and leases as secrets; require
  user gesture/permission, encrypt endpoint contents, bind to pubkey/relay,
  no sensitive plaintext payload, rate limit, and support unsubscribe/logout.
- **Tests/dependencies.** Service-worker integration tests, endpoint rotation,
  dedupe, logout revoke, tenant isolation, and privacy review. **P1 / XL.**

### 29. Agent memory and private local archival of managed-agent observability

- **Canonical contract.** Agent engrams `30174` and private managed aggregate
  `30179` are encrypted/owner-authorized. Observer frames `24200` and metric
  `44200` have narrow recipient/privacy rules; desktop local archive may retain
  only authorized events.
- **Desktop writer/read.** Desktop has agent-memory, observer archive, metrics
  archive, secret-aware managed agent state, and key material necessary for
  decryption.
- **Web current state.** No memory or observer archive UI; this is correct.
- **Implementation tasks / architecture required.** A web view needs an owner-authorized, end-to-end
  encrypted projection service or a browser-held authorized key protocol.
  Merely querying these events from the browser is unacceptable because it
  expands secret/key handling and risks disclosure. Start with redacted status
  summaries produced by the managed-runtime service, then decide whether full
  encrypted history is a product requirement.
- **Cache/realtime.** Keep redacted status and encrypted payload caches
  separate; lock/logout clears decrypted material and derived indexes.
- **Security/authorization.** Explicit threat model, no secrets in logs,
  owner-only/result-level authorization, key rotation/revocation, and audit.
- **Tests/dependencies.** Cryptographic interoperability and non-disclosure
  tests precede UI work. Depends on managed runtime architecture. **P2 / XL.**

## Desktop-only

| Capability | Why it remains desktop-only | Browser posture |
| --- | --- | --- |
| Tray, close-to-tray, dock/taskbar badge, native menu | Requires a resident OS application and native event loop. | Browser may show in-page unread state and foreground notifications; it must not claim resident behavior. |
| Native updater and signed app release flow | Tauri updater validates/installs a platform artifact. | Link to/download desktop release; browser app deploys through normal web hosting. |
| Native window drag, vibrancy, always-on-top, webview zoom pinning, detached windows | Shell/window-manager privileges and platform-specific rendering. | Responsive/PWA layout only; preserve accessibility/zoom standards. |
| Opening an OS terminal at a local checkout | Requires filesystem path and process launch on the user's machine. | Use the new remote-workspace architecture only if needed; never invoke a local shell. |
| Local managed-agent process installation/launch/restart and provider binary discovery | Requires local executable, environment, and secret ownership. | Browser may administer a separately designed remote service, never a hidden local process. |
| Persistent local GPU mesh daemon and VRAM/model-cache inspection | Requires native hardware/process/network control after the browser is closed. | Offer a separately named managed mesh or constrained WebGPU mode; do not call it the same capability. |
| OS idle/prevent-sleep and platform-native sound/device behavior | Tauri can request OS-specific facilities beyond reliable page lifetime. | Use optional Wake Lock/Web Audio with explicit degraded-state UI. |

## Cross-cutting implementation requirements

### Web platform primitives to build once

1. **Protocol module.** Kinds, tag helpers, replaceable head selection,
   coordinate parsing, channel scope checking, NIP-10 thread parsing, and a
   shared signed-event writer. Contract-test it against `buzz-core` fixtures and
   key docs rather than manually copying constants feature by feature.
2. **Relay data layer.** Wrap initial query + live subscription + reconnect
   replay. Every feature provides a narrowly scoped filter, receives
   de-duplicated events, applies authoritative access errors, and has a
   community/identity reset hook.
3. **Presentation layer.** One profile/agent projection resolver shared by
   messages, lists, reactions, Inbox, search, project work items, and forums.
   It must use pubkey joins and honor the agent-surface precedence matrix.
4. **Browser capability layer.** Centralize permission state, WebCrypto,
   IndexedDB, File/Blob/Canvas, object URLs, Web Audio, Notifications, camera,
   and feature detection. UI code must not call privileged browser APIs ad hoc.
5. **Security/error layer.** Standard handling for signer lock, NIP-42 auth,
   NIP-98 request signing, relay `restricted`/`auth-required`/authorization
   failures, malformed event data, and retryable connection state.

### Required cache and invalidation table

| Projection | Must invalidate/refetch after | Realtime subscription |
| --- | --- | --- |
| Channels/members | any `9000`/`9001`/`9002`/`9007`/`9008`, agent auto-add, community switch | `39000`/`39002` projections and bounded channel events |
| Profiles/agents | `0`, `30315`, `10100`, `30180`, membership change | rendered pubkeys + agent directory/config heads |
| Timelines/threads/reactions | message/reply/edit/delete/reaction; media event publish | channel `h`, thread target set, visible reactions |
| Inbox/Alerts/read markers | own `30078`, `46010`/recipient event, channel activity | own marker coordinate and recipient/channel source kinds |
| DM visibility | `41010`/`41012` | own `30622` `#p` snapshot |
| Projects/repos | `30621`, `30617`, `30618`, issue/PR/status/comment | project/repo/work-item coordinate heads |
| Forums | post/comment/vote/delete | `45001`–`45003` with `h` |
| Workflows | definition/trigger/approval/run trace | `30620`, `46001`–`46012` scoped by channel/viewer |
| Local-only state | relay/pubkey change, browser lock/logout | none; storage change events only |

## Staged execution roadmap

### Stage 0 — contracts and safety rails (P0)

1. Complete the `30180` hosted-agent configuration migration across core,
   relay, desktop, and web. Add fixtures proving no `30179` private aggregate
   leaks into a browser roster.
2. Establish the browser protocol, data/subscription, snapshot verification,
   and capability modules. Add a test fixture suite for event replacement and
   reconnect behavior.
3. Add route/feature inventory contract tests comparable to the desktop agent
   surface map so web routes cannot silently bypass shared presentation policy.

**Exit criterion:** current workspace E2E, relay authorization tests, and
agent-surface-map contract pass with `30180` as the sole target public config.

### Stage 1 — core collaboration completion (P1)

1. Profile/status and global search.
2. DM open/hide/reopen and presence/typing.
3. Forum routes and full media attachment adapter.
4. Workflow list/detail/approval UI and reminder management.
5. Project collection/read-only work items on top of current `/repos`.

**Exit criterion:** a browser-only user can join, navigate, communicate,
mention an eligible hosted agent, manage channels/DMs, search, use forums,
approve workflows, manage reminders, and inspect collaborative projects without
desktop assistance.

### Stage 2 — richer collaboration and portable device features (P2)

1. Pulse, custom emoji, moderation, identity archive, advanced channel state.
2. Browser audio huddle lifecycle + adapter, pairing/backup accessibility
settings, local offline archive.
3. Browser PR/issue comment/review polish and safe remote diff navigation.

**Exit criterion:** all non-native collaboration views in the desktop route
inventory have a browser route or a deliberate documented alternative.

### Stage 3 — architecture programs (P0/P1, separate releases)

1. Hosted/managed runtime control plane and redacted observability.
2. Web Push/service-worker delivery.
3. Remote workspace terminal (if product-approved).
4. Managed mesh control plane or explicitly limited WebGPU offering.

Each program needs a threat model, API/protocol review, relay authorization
integration, audit/operations plan, and isolation tests before browser UI.

## Parallel-safe work packages

| Package | Scope | Can run in parallel with | Must not overlap / dependency |
| --- | --- | --- | --- |
| A. Protocol migration | `30180`, shared kind/tag/head helpers, snapshot verifier, cache-reset contract | B–G after helper interfaces freeze | Blocks hosted config UI and agent presentation changes |
| B. Core people and navigation | profiles/status, search, identity archive, URL routes | C, D, E | Shares presentation resolver with A; coordinate imports centrally |
| C. Collaboration surfaces | forums, Pulse, advanced channel state, custom emoji | B, D, E | Depends on common composer API; one owner for Markdown/attachment interfaces |
| D. Relay-command surfaces | DMs, presence/typing, workflows, reminders | B, C, E | Depends on A's event helpers; do not create new REST endpoints |
| E. Project browser | NIP-MP fold, projects, issues/PRs/reviews, repository cache invalidation | B–D | Must reuse existing git client; terminal/local checkout excluded |
| F. Media and huddles | Blossom upload adapter, gallery/video, browser huddle audio | B–E | Media adapter API must stabilize before forum/project composer attachments |
| G. Device/local data | IndexedDB archive, pairing/backup/preferences | B–F | Owns browser storage schema/versioning; coordinate lock/logout reset |
| H. New services | managed runtime, push, remote terminal, mesh | all client packages after contracts exist | Separate threat-model/release streams; no frontend task may expose privileged desktop commands |

Suggested integration order is A → (B, D) → (C, E, G) → F → H. Each package
must add its own unit tests and browser E2E before integration. Relay integration
tests are mandatory for any new query filter, authorization gate, command kind,
or media/audio transport change.

## Verification checklist for every parity PR

- [ ] Event kind/tags and writer match `buzz-core/src/kind.rs` and the relay
      handler; no new bespoke HTTP feature API was introduced.
- [ ] Initial fetch, live subscription, reconnect, mutation invalidation, and
      community/identity reset are covered.
- [ ] Browser error state distinguishes locked signer, unauthenticated relay,
      authorization failure, malformed data, and transient network failure.
- [ ] All source-of-truth/precedence changes were checked against
      `docs/agent-surface-map.md` on both desktop and web.
- [ ] Sensitive kinds are not broadened by an `ids` query, kindless query,
      local archive, search index, or browser cache.
- [ ] Browser UI disables privileged operations only for UX and correctly
      handles relay denial; it never treats client state as authorization.
- [ ] New routes have keyboard/accessibility coverage and an E2E smoke path.
- [ ] Run web `pnpm check` and relevant Playwright specs; run relay integration
      tests when a relay contract changes. Documentation-only edits at minimum
      pass `git diff --check`.

## Source inventory

- Kind registry: `crates/buzz-core/src/kind.rs`.
- Relay authorization/ingest/commands: `crates/buzz-relay/src/handlers/ingest.rs`,
  `command_executor.rs`, `event.rs`, `api/bridge.rs`, and `audio/`.
- Desktop routes/features: `desktop/src/app/routes.ts`,
  `desktop/src/features/`, and `desktop/src-tauri/src/commands/`.
- Browser workspace and repository baseline: `web/src/features/workspace/`,
  `web/src/features/repos/`, `web/src/shared/lib/`, and `web/tests/`.
- Cross-surface agent source/precedence contract:
  `docs/agent-surface-map.md`.
- Protocol detail: `docs/nips/NIP-ER.md`, `NIP-IA.md`, `NIP-DV.md`, `NIP-MP.md`,
  `NIP-AP.md`, `NIP-PMA.md`, and `ARCHITECTURE.md`.

# Agent surface map

VarVik's production channel-to-agent responsibility boundaries and the
distinction between channel membership and runtime-declared external resources
are documented in [`varvik-channel-routing.md`](varvik-channel-routing.md).

This is the change-impact map for agent identity, configuration, discovery,
membership, and message presentation in Buzz. Read it before changing an agent
name, avatar, model, access rule, channel relationship, mention, or historical
message projection.

The purpose of this document is operational: a change is not complete until its
row in the consumer matrix has been checked on every applicable client. The
contract test at
`desktop/src/features/agents/lib/agentSurfaceMapContract.test.mjs` keeps the
declared application routes and the most important canonical-policy imports in
sync with this map.

## The identity key

An agent is joined across every surface by its lowercase 64-character public
key. Names, aliases, pictures, persona ids, and channel labels are presentation
data and must never be used as the join key.

Renaming or re-picturing an agent therefore does not rewrite messages. Clients
project the current authoritative presentation over the pubkey stored on each
historical event.

## Sources of truth and precedence

| Data | Event/storage | Writer | Precedence and purpose |
| --- | --- | --- | --- |
| Human compatibility profile | kind `0` | Profile owner | Human profile source. For hosted agents this is fallback presentation only. |
| Hosted agent directory | kind `10100` (`KIND_AGENT_PROFILE`) | Agent | Base hosted identity, owner, access tier, audience, response policy, channels, status, capabilities, runtime-declared resources, desired/default model, and signed runtime model catalog. |
| Persona definition | kind `30175` (`KIND_PERSONA`) | Owner | Durable persona name, avatar, behavior, provider, model, runtime, and sharing definition for managed agents. |
| Team definition | kind `30176` (`KIND_TEAM`) | Owner | Owner-private grouping of persona ids. |
| Managed-agent projection | kind `30177` (`KIND_MANAGED_AGENT`) | Owner | Public, secret-free managed-agent projection keyed by agent pubkey. Also supports the namespaced compatibility form `hosted-agent:<pubkey>` on older relays. |
| Team catalog | kind `30178` (`KIND_TEAM_CATALOG`) | Owner | Shareable team projection with embedded public persona projections. |
| Hosted admin override | kind `30180` (`KIND_HOSTED_AGENT_CONFIG`) | Community owner/admin or declared agent owner | Public, secret-free hosted name, avatar, and desired model. Runtime-authored kind `10100` remains the source for a description and aliases. Its exact v1 schema accepts only `schema`, `agent_pubkey`, `name`, `avatar_url`, and `model`; a browser must never add a role, alias, or summary field to this event. Newest authorized `(created_at, event_id)` head wins over kind `10100` and kind `0`. Kind `30179` is exclusively the encrypted, author-only managed-agent aggregate. |
| Channel membership | NIP-29 membership events; channel state uses `h` tags, membership addressables use `d` tags | Channel owner/admin | Determines whether an agent is already in a channel. It does not determine whether a shared agent is discoverable before its first invitation. |
| Channel catalog section | Relay `channels.catalog_section`, emitted as kind `39000` `catalog_section` tag | Channel owner/admin or community owner/admin via kind `9007`/`9002` | Shared web/desktop organization. It is not a local sidebar preference. An empty value explicitly clears the section. |
| Agent channel-add admission | Community-scoped `users.agent_owner_pubkey` plus `users.channel_add_policy` | Relay-authenticated agent or root operator | Owner mapping is immutable. `buzz-admin set-agent-owner` atomically ensures both principals, binds the owner, and sets `owner_only`; it never opens an `anyone` window. |
| Message author | message event `pubkey` | Sender | Stable identity reference for timeline and Inbox. Presentation is resolved at render time. |
| Local managed record | desktop encrypted/local managed-agent store | Agent owner | Runtime command, secrets, environment, lifecycle and local instance fields that must never enter public projections. |
| Global agent defaults | desktop local configuration | Current desktop user | Defaults only. Per-agent settings override them. |

### Field rules

| Field | Canonical read |
| --- | --- |
| Hosted name/avatar | Authorized kind `30180` override, then kind `10100`, then kind `0`. Desktop projection: `getHostedAgentPresentation` / `overlayHostedAgentProfiles`. Web projection: `applyHostedAgentConfigs`. Only the namespaced `30177` `d=hosted-agent:<pubkey>` form is a compatibility read; `30179` is never read as hosted configuration. |
| Managed name/avatar | Managed record plus its persona definition; kind `0` is republished for compatibility. Cache invalidation must follow successful edits. |
| Hosted model options | Signed `models` catalog from kind `10100`; never a frontend provider/model table. |
| Hosted selected model | Authorized kind `30180` desired model. A live save also sends observer `switch_model` to known agent channels. |
| Hosted resources | Signed kind `10100` `resources` list published by the runtime. It is descriptive metadata only; kind `30180` and browser UI cannot grant external credentials. Buzz channel access is enforced separately through NIP-29 membership. |
| Hosted role/summary | The first sentence of signed kind `10100` `about`, then a signed `aliases` entry as a presentation fallback. Kind `30180` deliberately cannot override either field. Correct a stale or incorrect role by republishing the hosted runtime directory entry; do not add a browser-only override. |
| Managed model options | Rust `KnownAcpRuntime` capability catalog and live discovery. Frontend fields are projected through `agentConfigCore.ts`. |
| Discovery/access | `audience` and `accessTier` are authoritative. `shared/community` is community-discoverable before channel membership. `personal/admin` is restricted to its owner. Legacy records without those fields fall back to `respondTo` and its allowlist. Desktop policy: `relayAgentIsSharedWithUser`. |
| Channel invocation | Mention send flow adds an eligible missing agent with role `bot`, then sends a message carrying its `p` tag. Other users' private agents must not be suggested or added. |

## Write flows

### Bind a deployed agent to its owner

1. A root operator runs `buzz-admin set-agent-owner --agent-pubkey <key>
   --owner-pubkey <key>` against the relay's configured community.
2. `buzz-db::bind_agent_owner_owner_only` ensures both user rows, locks the
   agent row, preserves an existing identical owner, rejects owner replacement,
   and commits the owner plus `channel_add_policy=owner_only` in one database
   transaction.
3. Subsequent NIP-29 channel-add authorization permits the declared owner and
   continues to reject unrelated users. This is an operator bootstrap path, not
   a browser or ordinary member command.
4. A managed deployment that has already reconciled the private channel sets
   `BUZZ_ACP_SKIP_PRIVATE_OWNER_BOOTSTRAP=true`. The agent entrypoint still
   resolves and subscribes to that channel, but does not repeat the privileged
   owner-role write as the agent's bot identity.

Primary files:

- `crates/buzz-admin/src/main.rs`
- `crates/buzz-db/src/user.rs`
- `crates/buzz-db/src/lib.rs`
- `deploy/compose/agent-entrypoint.sh`

### Edit a hosted agent

1. Desktop `/agents` opens `HostedAgentEditDialog.tsx`; web's internal Agents
   view opens the editor in `WorkspaceAgents.tsx`. Both surfaces accept a local
   picture file and upload it to the authenticated community media service
   before persisting the returned URL.
2. `publishHostedAgentConfig` signs public kind `30180` with exactly one
   `d=<agent-pubkey>` tag and the matching `buzz.hosted-agent-config.v1` JSON
   body. An old relay that reports an unknown kind receives only the namespaced
   kind `30177` `d=hosted-agent:<pubkey>` compatibility projection. It never
   writes kind `30179`.
3. `list_relay_agents` and web `listAgents` select the newest authorized head
   and merge it onto kind `10100`.
4. The relay-agent query is invalidated/refetched.
5. The web editor intentionally exposes only name, picture, and desired model.
   It cannot edit a hosted agent's role or summary: the relay rejects any extra
   `30180` JSON key, and kind `10100` remains runtime-authored. Correct that
   source and let the signed directory refresh both clients.
6. If a model was selected, the desktop sends `switch_model` control to every
   known channel for that agent. Web exposes only models advertised by the
   signed runtime catalog and persists the desired selection; it does not
   claim that a presentation event can install a provider or grant credentials.
7. Rosters, profiles, search, mentions, messages, and Inbox resolve the merged
   name/avatar/model by pubkey.

Migration: historic `30179` documents are intentionally not read or migrated,
because their NIP-33 coordinate overlaps the encrypted private managed-agent
aggregate. An authorized owner/admin must republish the secret-free hosted
presentation as a new `30180` event.

Primary files:

- `desktop/src/features/agents/ui/HostedAgentEditDialog.tsx`
- `desktop/src/features/agents/lib/hostedAgentConfig.ts`
- `desktop/src-tauri/src/commands/agent_discovery.rs`
- `desktop/src/features/agents/lib/hostedAgentPresentation.ts`
- `web/src/features/workspace/workspace-api.ts`
- `web/src/features/workspace/workspace-agent-models.ts`
- `web/src/features/workspace/ui/WorkspaceAgents.tsx`

### Edit a managed agent/persona

1. Desktop `/agents` opens the managed-agent/persona edit flow.
2. `update_managed_agent` and/or `update_persona` persists the private runtime
   record and public kind `30175`/`30177` projections.
3. The backend republishes the compatible kind `0` profile when presentation
   changes.
4. `useUpdateManagedAgentMutation` evicts per-pubkey batch entries and
   invalidates managed agents, relay agents, single profiles, and affected
   users-batch queries.
5. Channel member presentation is patched immediately while the relay update
   settles.

Primary files:

- `desktop/src/features/agents/hooks.ts`
- `desktop/src/shared/api/tauri.ts`
- `desktop/src/shared/api/tauriPersonas.ts`
- `desktop/src-tauri/src/commands/agents.rs`
- `desktop/src-tauri/src/commands/personas/`
- `desktop/src-tauri/src/commands/agents_profile.rs`

### Mention an agent

1. Candidate identity is assembled in `useMentions.ts` from channel members,
   managed agents, the hosted directory, and profile results.
2. `relayAgentIsSharedWithUser` makes the access decision. Directory name wins
   over stale channel/profile names.
3. `useMentionSendFlow.ts` identifies eligible agents missing from the channel.
4. Owner/admin send adds them through `add_channel_members` with role `bot`.
5. `send_channel_message` includes agent pubkeys as `p` tags.
6. The web client mirrors this in `useAgentMentionDelivery.ts` using
   `addWorkspaceMember` and `sendWorkspaceMessage`.

### Manage channel catalog and membership

1. Channel creation publishes kind `9007`; optional `catalog_section` is
   validated and persisted by the relay.
2. Rename, description, visibility, archive/unarchive, and section edits
   publish kind `9002`; delete publishes kind `9008`.
3. Invite, remove, and role change publish the established kind `9000`/`9001`
   NIP-29 events. Channel owners/admins control their own channel; relay
   community owners/admins retain global recovery control.
4. The relay emits the updated relay-signed kind `39000`/`39002` discovery
   heads. The relay fans those heads to exclusively discovery-only live
   subscriptions, then rechecks channel access before delivery. Web subscribes
   to the catalog plus recipient `44100`/`44101` membership signals and
   invalidates immediately; neither client owns a second catalog.
5. Agent automation uses `buzz channels create --catalog-section <section>`
   and `buzz channels update --catalog-section <section>`. An update can
   explicitly remove the assignment with `--clear-catalog-section`; these CLI
   paths build the same kinds `9007`/`9002` through `buzz-sdk`.

Primary files:

- `crates/buzz-relay/src/handlers/side_effects.rs`
- `crates/buzz-db/src/channel.rs`
- `crates/buzz-cli/src/commands/channels.rs`
- `crates/buzz-sdk/src/builders.rs`
- `desktop/src/features/channels/ui/ChannelManagementSheet.tsx`
- `web/src/features/workspace/ui/WorkspaceChannelSettings.tsx`
- `web/src/features/workspace/ui/WorkspaceSidebar.tsx`

Catalog limitation: sections are metadata tags on channels, not standalone
entities. A section with no channels cannot be retained or displayed after its
last channel moves/deletes. Introduce a dedicated catalog event only if empty
section management becomes a product requirement.

### Route an item to Inbox

Inbox is a decision queue, not a copy of chat. The cross-client contract is:

1. Only a pending kind `46010` workflow approval request with a `p` tag for the
   current identity enters Inbox.
2. Mentions and replies enter Alerts. Direct messages remain in their DM.
   Reminders, agent lifecycle updates, and ordinary channel messages remain on
   their dedicated surfaces.
3. Free text such as “waiting for approval” and status-like tags do not create
   Inbox work. Producers must emit the structured approval event.
4. Dismiss and Clear Inbox write per-event `inbox-dismiss:<event-id>` markers
   through the existing encrypted kind `30078` NIP-RS state. They never delete
   or mark the source channel message read.
5. Terminal grant/deny events (kinds `46011` and `46012`) never enter Inbox.

Primary files:

- `desktop/src-tauri/src/commands/messages.rs`
- `desktop/src/features/home/lib/inboxViewHelpers.ts`
- `desktop/src/features/home/ui/HomeView.tsx`
- `web/src/features/workspace/workspace-read-state.ts`
- `web/src/features/workspace/ui/WorkspaceInbox.tsx`

### Sync a community appearance

1. Desktop persists the active per-user, per-relay appearance locally and
   publishes its encrypted NIP-78 kind `30078` event with `d=community-theme`.
2. Web restores an optimistic per-user, per-relay local cache/outbox, queries
   and subscribes to that exact author/tag coordinate after the browser
   identity is unlocked, and validates/decrypts the newest event before
   applying it to its root theme provider.
3. Browser appearance edits write that scoped outbox immediately, then publish
   the same encrypted kind `30078` coordinate with a monotonic timestamp; the
   outbox survives temporary relay failure and is cleared only on accepted
   publication.
4. The event is encrypted to the author. A browser identity with a different
   pubkey cannot read it and must keep the default appearance rather than
   inheriting a different user's look.

Primary files:

- `desktop/src/shared/theme/communityThemePreference.ts`
- `desktop/src/shared/theme/communityThemeSync.ts`
- `web/src/shared/theme/CommunityThemeController.tsx`
- `web/src/shared/theme/community-theme.ts`
- `web/src/shared/theme/community-theme-preference.ts`
- `web/src/shared/theme/community-theme-sync.ts`

## Consumer matrix

Every checkmark is a required verification when that field changes.

| Surface | Route/view | Name/avatar | Model | Access | Channels | Main implementation |
| --- | --- | :---: | :---: | :---: | :---: | --- |
| Agent roster and edit | Desktop `/agents` | ✓ | ✓ | ✓ | ✓ | `AgentsView.tsx`, `HostedAgentsSection.tsx`, `HostedAgentEditDialog.tsx` |
| Agent profile panel | Desktop `/agents?profile=<pubkey>&profileView=<view>&profileTab=<tab>` and panels opened from other routes | ✓ | ✓ | ✓ | ✓ | `UserProfilePanel.tsx`, `UserProfilePanelUtils.ts` |
| Channel composer/autocomplete | Desktop `/channels/$channelId` | ✓ |  | ✓ | ✓ | `useMentions.ts`, `MentionAutocomplete.tsx`, `useMentionSendFlow.ts` |
| Channel member/header/avatar | Desktop `/channels/$channelId` | ✓ |  | ✓ | ✓ | channel hooks, `BotActivityBar.tsx`, profile batch cache |
| New message | Desktop `/messages/new` | ✓ |  | ✓ |  | `NewMessageScreen.tsx`, mention candidate helpers |
| Global search | Desktop overlay on all routes | ✓ |  | ✓ |  | `useSearchResults.ts`, `TopbarSearch.tsx` |
| Timeline and threads | Desktop channel/post routes | ✓ |  |  |  | `formatTimelineMessages.ts`, `MessageRow.tsx`, `MessageThreadPanel.tsx` |
| Inbox decision list and detail | Desktop `/` | ✓ |  |  | ✓ | `messages.rs`, `HomeView.tsx`, `inboxViewHelpers.ts` |
| Inbox decision list | Web `/`, internal `inbox` view | ✓ |  |  | ✓ | `workspace-read-state.ts`, `WorkspaceInbox.tsx` |
| Agents workspace | Web `/`, internal `agents` view | ✓ | ✓ | ✓ | ✓ | `WorkspaceAgents.tsx`, `workspace-api.ts` |
| Web composer/timeline | Web `/`, internal `channel`/`inbox` views | ✓ |  | ✓ | ✓ | `WorkspaceComposer.tsx`, `useAgentMentionDelivery.ts`, `WorkspaceMessageRow.tsx` |
| Runtime process | Desktop native backend |  | ✓ | ✓ | ✓ | managed-agent runtime modules and observer `switch_model` |

## Application route inventory

This inventory includes all declared routes, including routes without an agent
surface. The contract test requires every declared route to remain listed so a
new route cannot silently bypass this impact analysis.

### Desktop

- `/` — Home/Inbox; agent author presentation is visible here.
- `/alerts` — alert messages may carry agent authors/mentions.
- `/agents` — roster, profile and configuration source surface.
- `/drafts` — personal unsent channel and thread messages.
- `/pulse` — activity can carry agent identity.
- `/reminders` — reminders can link to agent-authored messages.
- `/settings` — global agent defaults and runtime setup.
- `/workflows`
- `/workflows/$workflowId`
- `/projects`
- `/projects/$projectId`
- `/messages/new` — recipient and mention discovery.
- `/channels/$channelId` — primary messages, members and mentions.
- `/channels/$channelId/posts/$postId` — forum/thread presentation.

Desktop profile panels are URL-addressable subviews rather than standalone
routes. The stable search keys are `profile`, `profilePersona`, `profileView`,
and `profileTab`. Profile views are parsed centrally by
`UserProfilePanelUtils.ts`; do not invent a surface-local query key.

### Web

- `/` — workspace shell. Its internal state views are `channel`, `inbox`,
  `alerts`, and `agents`; these are not separate URLs.
- `/invite/$code`
- `/messages/new` — direct-message recipient and agent discovery.
- `/messages/$channelId` — direct-message timeline; agent-authored messages use
  the same profile, directory, mention, and workflow-attribution contracts as
  channel messages.
- `/channels/$channelId/posts` — channel forum index with agent-authored posts,
  current profile presentation, mentions, reactions, and reminder actions.
- `/channels/$channelId/posts/$postId` — forum post and comment detail using
  the same author/profile projection as the channel timeline.
- `/reminders` — encrypted reminders can link back to agent-authored messages.
- `/profiles/$pubkey` — person or agent profile and status presentation.
- `/pulse` — bounded channel activity that can contain agent authors.
- `/settings` — browser-relevant identity, appearance, notification, agent,
  archive, pairing, and management settings.
- `/custom-emoji` — identity-owned emoji sets used by messages and reactions.
- `/search` — message and profile search results can contain agent identities.
- `/repos`
- `/repos/$repoId`
- `/repos/$repoId/blob/$`
- `/projects` — global NIP-MP collection plus implicit NIP-34 repositories.
- `/projects/$projectAddress` — strict addressable `30621:<owner>:<d>` project.
- `/repos/$repositoryAddress/work-items` — exact-address NIP-34 issue/PR list
  and activity; it never treats a repository `d` tag as globally unique.
- `/repos/$repositoryAddress/work-items/$workItemId` — read-only issue/PR
  detail, comments, updates, trusted status, and review projection.
- `/workflows` — browser workflow definition list/create and approval queue.
- `/workflows/$workflowId` — browser workflow definition, manual command, and
  event-trace view.

Relay-generated workflow messages remain signed by the relay key but carry the
workflow owner's pubkey in `actor`, the stable workflow UUID in
`buzz:workflow`, and the trusted display name in `workflow-name`. Web clients
must present these as workflow automation, not as an unnamed relay user; the
signing pubkey remains authoritative for edit/delete ownership checks.
- `/channel-state` — browser-local drafts plus encrypted relay/identity-scoped
  channel mute/star state; accepts `channel` and optional `thread` search keys.
- `/moderation` — NIP-98-authorized moderator reports/restrictions/audit view.
- `/identity-archive` — relay-signed archive snapshot and protected archive
  request controls; archive is presentation state, never membership removal.
- `/huddles/$channelId` — parent-channel-scoped lifecycle history, guideline
  editor, and an explicitly joined browser audio session. Historical lifecycle
  membership is presentation only and never grants audio admission.
- `/offline` — browser-local, encrypted read archive. Its IndexedDB v1 scope is
  normalized relay URL plus unlocked identity; it stores only verified ordinary
  events received through explicit `h`-scoped channel reads/subscriptions.
  Archive records are never a relay source of truth and exclude private/decrypted
  payloads.
- `/pairing` — user-gesture-only NIP-AB browser pairing using the relay's
  advertised sidecar and kind `24134`; source devices render the same
  short-lived URI as a QR code, while target devices may use a capability-gated
  camera scanner or the manual URI field. QR camera streams, ephemeral session
  material, and recovered key payloads are memory-only and stop/clear on scan,
  cancel, timeout, or route exit.
- `/preferences` — relay+identity-scoped browser-only notification and
  accessibility settings. It does not represent a relay setting or desktop
  system preference.

The browser workspace consumes the same relay events but does not share the
desktop TypeScript bundle. Any change to event shape, precedence, access, or
mention delivery must therefore update and test both clients explicitly.

## Cache and refresh boundaries

| Cache/query | What it contains | Required invalidation |
| --- | --- | --- |
| `relayAgentsQueryKey` | Merged kind `10100` plus authorized kind `30180`/namespaced `30177` compatibility configuration | Hosted identity/model/access edits; community switch. |
| `managedAgentsQueryKey` | Local managed instances | Managed create/edit/delete and runtime lifecycle changes. |
| `['user-profile', pubkey]` | Kind `0` profile | Profile or managed presentation update. |
| `['users-batch-entry', pubkey]` and `['users-batch', ...]` | Timeline, member, Inbox profile projection | Evict entry before invalidating aggregate queries after name/avatar changes. |
| Channel members/details | Membership and member presentation | Add/remove role changes and managed identity edits. |
| Web `['workspace-agents', viewerPubkey]` | Merged browser agent directory | Immediate invalidation on live kind `10100`, `30180`, namespaced `30177`, or `13534`, plus local hosted config publication and identity/community change. |
| Web `['workspace-channels', viewerPubkey]` | Membership projection | Immediate invalidation on live relay kind `39000`/`39002`, addressed `44100`/`44101`, or `13534`, plus local channel create/update/archive/delete/member writes. |
| Web/desktop channel detail and list queries | Relay kind `39000` channel metadata, including `catalog_section` | Channel metadata, catalog section, archive/visibility, and membership mutations. |
| Web `['workflow-channel', channel]` and `['workflow-detail', id]` | Strictly projected kind `30620` workflow definition heads | Live kind `30620` scoped by `h` or `d`, plus local definition replacement/delete. Keep timestamp then lowest-id replacement order. |
| Web `['workflow-trace', id]` and `['workflow-approvals', viewer]` | Explicit relay kinds `46001`–`46007` and viewer-tagged `46010` | Matching live workflow trace or approval event, and successful `46020`/`46030`/`46031` command. Approval events must retain a matching `p` tag locally; relay filter results alone are not authoritative. |
| Web `['projects','collection']` / `['projects','detail', projectAddress]` | Strict NIP-MP `30621` and NIP-34 `30617` heads plus owner-authorized NIP-09 `5` deletion edges | Live `30621`/`30617` heads and known-coordinate deletion events refetch the bounded, timestamp-bucket-safe fold. Same-second replaceable heads select the lowest id; foreign project membership remains visible but cannot suppress the repository's implicit card. |
| Web `['projects','work-items', repositoryAddress]` | Exact `30617:<owner>:<d>` scoped NIP-34 issues `1621`, PRs/patches/updates `1617`–`1619`, status `1630`–`1633`, and kind `1` comments | One explicit-kind `#a` subscription invalidates list/detail/activity. The client locally validates exact repository/root edges and trusted lifecycle/review actors; relay authorization remains the access authority. |
| Web `['channel-mutes', pubkey]` / `['channel-stars', pubkey]` | Encrypted NIP-78 `30078` heads with exact `d`/`t` coordinates | Same-author live head, local publish, and relay/identity boundary. Both registers merge a persisted outbox with the observed remote head and publish a strictly newer timestamp. |
| Web `['archived-identities']` | Verified relay-signed kind `13535` archive snapshot | Relay-signer `13535` live event or successful `9035`/`9036` request. Never accept an unsigned/foreign snapshot. |
| Web `['moderation-reports']`, `['moderation-audit']`, `['moderation-restrictions']` | NIP-98-authorized moderator views | Successful `9040`–`9044` command and bounded refresh; reports/direct commands have no normal WS fan-out. |
| Web `['channel-huddles', parentChannelId]` | Validated kinds `48100`–`48103` scoped by the parent `h` tag | Matching live lifecycle event, successful browser start, or lifecycle subscription reconnect. Fold exact ids by `(created_at ASC, id ASC)`; ending clears active participants. |
| Web `['huddle-guideline', ephemeralChannelId]` | Latest nonempty kind `48106` scoped by backing-channel `h` | Matching live guideline event or successful local guideline write. Select newest `(created_at DESC, id ASC)` head. Audio capture/packets are intentionally never query-cached. |
| Web `['offline-archive-channels', pubkey]`, `['offline-archive-page', pubkey, cursor]`, `['offline-archive-usage', pubkey]` | Browser-local encrypted IndexedDB archive for the current normalized relay + identity partition | User-triggered archive/read/clear/import/export and its optional foreground exact-kind + `h` subscription. Remove all three caches on identity lock; changing relay or identity selects a different partition. |

Community switching remounts the React tree, but module-level caches must also
be reset in `resetCommunityState()` as described in the root `AGENTS.md`.

## One-change checklist

### Name or avatar

- Update the authoritative writer, not only kind `0`.
- Confirm authorized override precedence in desktop and web.
- Confirm roster, profile panel, channel member list/header, search, mention
  dropdown, timeline/thread, and both Inbox columns.
- Confirm historical events change presentation without being rewritten.
- Confirm the relevant single-profile, batch-profile and directory caches are
  invalidated.

### Model or provider

- Managed capability facts start in Rust `KnownAcpRuntime`.
- Hosted options come only from the signed kind `10100` model catalog.
- Persist the selected value in the correct per-agent source.
- Apply it to a running instance or explicitly state when restart is required.
- Verify global defaults do not overwrite per-agent selection.
- Verify desktop and web read the same desired hosted model.

### Access or audience

- Update `relayAgentIsSharedWithUser` and its tests first.
- Verify owned personal/admin agents remain available to the owner.
- Verify another owner's personal/admin agents remain absent.
- Verify shared/community agents appear before joining any channel.
- Verify autocomplete, global search, agent roster, profile channels and web
  workspace agree.

### Channel membership or mentions

- Use `h` tags for events inside channels and the established membership
  operations/addressable `d`-tag rules for channel membership projections.
- Verify first mention auto-adds an eligible agent as `bot` and sends a `p` tag.
- Verify a failed add blocks the message with human-readable feedback.
- Verify channel and profile membership lists refresh immediately.

### Channel catalog or permissions

- Publish only NIP-29 kinds `9007`, `9000`, `9001`, `9002`, or `9008`; do not
  add a local-only catalog or endpoint-specific HTTP API.
- Verify the relay-signed kind `39000` exposes the new metadata to desktop and
  web, and both sidebars group from that tag rather than a channel-name list.
- Verify a channel owner/admin can manage that channel, a community owner/admin
  can recover any channel, and an ordinary member only receives the existing
  open-channel/self-service permissions.

### Release

- Run the affected pure tests and browser test first.
- Run desktop typecheck, Biome, and full unit tests.
- If web code changed, run its checks and tests separately.
- Build desktop only after tests pass. A local desktop build does not deploy the
  web client or relay; record those deployments independently.

## Required regression coverage

- `agentAutocompleteEligibility.test.mjs` — owner/private/shared/legacy access.
- `hostedAgentPresentation.test.mjs` — hosted override over stale kind `0`.
- `mentions.spec.ts` — shared agent with no channel and stale runtime policy is
  suggested, added, and tagged.
- `agentSurfaceMapContract.test.mjs` — route inventory and canonical consumer
  wiring.
- `onboarding-agent-defaults.spec.ts` — managed runtime/provider/model setup.
- Relay ingest, privacy, subscription, and agent-discovery tests — `30180`
  schema/authorization, `30179` author-only privacy, live catalog fan-out, and
  newest authorized hosted override.

## Known consolidation work

The following seams remain intentionally visible here until removed:

1. Desktop and web have separate event parsers and presentation projectors.
   Event-shape changes require both implementations and both test suites.
2. Kind constants are canonical in `buzz-core`, but web currently mirrors a
   local subset in `workspace-api.ts`. A shared generated schema would remove
   this duplication.
3. Hosted presentation overlay is explicit in desktop Inbox/profile paths;
   some generic human-profile consumers still read kind `0` directly. New
   agent-aware surfaces must consume the directory projection, never add
   another precedence rule.
4. Desktop relay-agent discovery still polls rather than subscribing to one
   unified `10100`/`30180` invalidation event. Web now subscribes directly;
   desktop realtime invalidation remains consolidation work.
5. The web composer detects typed names rather than providing the desktop's
   structured autocomplete. It uses the current merged directory, but parity
   should eventually share generated policy fixtures.
6. Web hosted-agent roster discovery is kind `10100` only. Kind `30177` remains
   a managed projection and may be used only as the namespaced compatibility
   form of an authorized hosted configuration overlay; it must not create a
   shared roster entry by itself.

Do not hide these gaps with surface-specific fallbacks. Either use the
canonical helper named above or update this map as part of consolidating the
source of truth.

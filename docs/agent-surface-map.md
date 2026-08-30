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
| Hosted agent directory | kind `10100` (`KIND_AGENT_PROFILE`) | Agent | Base hosted identity, owner, access tier, audience, response policy, channels, status, capabilities, runtime-declared resources, desired/default model, signed canonical `model_families`, and a legacy flat `models` compatibility projection. |
| Persona definition | kind `30175` (`KIND_PERSONA`) | Owner | Durable persona name, avatar, behavior, provider, model, runtime, and sharing definition for managed agents. |
| Team definition | kind `30176` (`KIND_TEAM`) | Owner | Owner-private grouping of persona ids. |
| Managed-agent projection | kind `30177` (`KIND_MANAGED_AGENT`) | Owner | Public, secret-free managed-agent projection keyed by agent pubkey. Also supports the namespaced compatibility form `hosted-agent:<pubkey>` on older relays. |
| Team catalog | kind `30178` (`KIND_TEAM_CATALOG`) | Owner | Shareable team projection with embedded public persona projections. |
| Hosted admin override | kind `30180` (`KIND_HOSTED_AGENT_CONFIG`) | Exact current community owner | Public, secret-free hosted name and avatar presentation. Its legacy `model` member is preserved for compatibility but is not an effective-runtime assertion. Runtime-authored kind `10100` remains the source for description, aliases, model catalog, and signed effective runtime. Kind `30179` is exclusively the encrypted, author-only managed-agent aggregate. |
| Hosted runtime request/status | encrypted kind `24201` request, controller kind `30181` status, encrypted kind `24200` controller/runner frames, and agent kind `10100.runtime` acknowledgment | Exact current community owner → pinned controller → exact agent | Model, reasoning effort, and runtime-facing name are one per-agent revision. The controller status describes desired/pending state; only the exact self-authored `10100.runtime` acknowledgment is effective. |
| Channel membership | NIP-29 membership events; channel state uses `h` tags, membership addressables use `d` tags | Channel owner/admin | Determines whether an agent is already in a channel. It does not determine whether a shared agent is discoverable before its first invitation. |
| Channel catalog section | Relay `channels.catalog_section`, emitted as kind `39000` `catalog_section` tag | Channel owner/admin or community owner/admin via kind `9007`/`9002` | Shared web/desktop organization. It is not a local sidebar preference. An empty value explicitly clears the section. |
| Agent channel-add admission | Community-scoped `users.agent_owner_pubkey` plus `users.channel_add_policy` | Relay-authenticated agent or root operator | Owner mapping is immutable. `buzz-admin set-agent-owner` atomically ensures both principals, binds the owner, and sets `owner_only`; it never opens an `anyone` window. |
| Message author | message event `pubkey` | Sender | Stable identity reference for timeline and Inbox. Presentation is resolved at render time. |
| Local managed record | desktop encrypted/local managed-agent store | Agent owner | Runtime command, secrets, environment, lifecycle and local instance fields that must never enter public projections. |
| Live agent activity | Ephemeral encrypted kind `24200` (`KIND_AGENT_OBSERVER_FRAME`) | Managed agent / ACP harness | Owner-only observer frames used for current work, liveness, and safe activity descriptors. They are never a relay archive or a community directory signal. |
| Turn metric archive | Persistent encrypted kind `44200` (`KIND_AGENT_TURN_METRIC`) plus local archive index | Managed agent / ACP harness | Owner-only, device-local reported usage. The archive can return partial/unknown counters and estimates; it is not a billing ledger or public model assertion. |
| Global agent defaults | desktop local configuration | Current desktop user | Defaults only. Per-agent settings override them. |

### Field rules

| Field | Canonical read |
| --- | --- |
| Hosted name/avatar | Authorized kind `30180` override, then kind `10100`, then kind `0`. Desktop projection: `getHostedAgentPresentation` / `overlayHostedAgentProfiles`. Web projection: `applyHostedAgentConfigs`. Only the namespaced `30177` `d=hosted-agent:<pubkey>` form is a compatibility read; `30179` is never read as hosted configuration. |
| Managed name/avatar | Managed record plus its persona definition; kind `0` is republished for compatibility. Cache invalidation must follow successful edits. |
| Hosted model options | Signed canonical `model_families` from kind `10100`; never a frontend provider/model table. The flat `models` array is a one-row-per-family compatibility projection only. Exact ACP stable/unstable aliases and switch bindings stay private to the runtime controller. |
| Hosted selected runtime | Self-authored kind `10100.runtime` for effective model, effort, runtime name, controller, revision, and catalog digest; pinned-controller kind `30181` for pending/applying/failed state. Kind `30180.model` is compatibility-only and never overlays effective runtime. |
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
5. Only the exact current community owner can edit a hosted agent in the web
   client. The editor intentionally exposes name, picture, one model-family
   selector, and a separate supported reasoning-effort selector. Model and
   effort are one per-agent default; they are never flattened into duplicate
   model-per-effort rows.
   It cannot edit a hosted agent's role or summary: the relay rejects any extra
   `30180` JSON key, and kind `10100` remains runtime-authored. Correct that
   source and let the signed directory refresh both clients.
6. A pure model/effort change emits only encrypted kind `24201`, never a public
   kind `30180`. A name change publishes kind `30180` first and binds its
   accepted event id into the encrypted runtime reconcile request; an
   avatar-only edit needs no runtime reconcile. Both writes are preflighted
   before either side effect begins.
7. A runtime change is encrypted to the pinned controller as kind `24201`.
   The controller persists and sends an exact binding over controller-authored
   kind `24200`. `buzz-acp` stops new claims, lets every active turn finish,
   probes and commits model/effort/name together, merges a self-authored kind
   `10100` acknowledgment, and then resumes the ordinary queue. Direct owner
   observer `switch_model` returns `managed_by_controller` on managed runners.
8. Startup remains gated until matching signed controller status plus agent
   acknowledgment prove the current revision, or the controller replays a
   pending revision. Lazy runners wake for a trusted controller frame.
9. Rosters, profiles, search, mentions, messages, and Inbox resolve presentation
   by pubkey while runtime cards project signed effective plus trusted pending state.

Migration: historic `30179` documents are intentionally not read or migrated,
because their NIP-33 coordinate overlaps the encrypted private managed-agent
aggregate. The exact current community owner must republish the secret-free hosted
presentation as a new `30180` event.

Primary files:

- `desktop/src/features/agents/ui/HostedAgentEditDialog.tsx`
- `desktop/src/features/agents/lib/hostedAgentConfig.ts`
- `desktop/src-tauri/src/commands/agent_discovery.rs`
- `desktop/src/features/agents/lib/hostedAgentPresentation.ts`
- `web/src/features/workspace/workspace-api.ts`
- `web/src/features/workspace/workspace-agent-models.ts`
- `web/src/features/workspace/ui/WorkspaceAgents.tsx`
- `crates/buzz-acp/src/runtime_control.rs`
- `crates/buzz-acp/src/runtime_defaults.rs`
- `crates/buzz-acp/src/runtime_profile.rs`
- `crates/buzz-acp/src/runtime_identity.rs`

The hosted runtime probes stable ACP `configOptions` and unstable
`availableModels` once per fresh session. `buzz-acp::runtime_catalog` collapses
identical display aliases into one base family, separates recognized reasoning
efforts, prefers stable exact switch bindings, and computes the catalog digest.
`deploy/compose/agent-entrypoint.sh` publishes only the canonical public
families and flat compatibility projection; it must never reconstruct or
publish exact adapter bindings itself.

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

### Operate my agents

1. Desktop `/agents` renders the **My agents** fleet before the hosted catalog.
   It contains only locally managed agents and kind `10100` agents whose
   declared `ownerPubkey` equals the current identity. Shared/community agents
   stay in the hosted catalog and never receive another user's activity or
   usage projection.
2. `useAgentObserverIngestion` subscribes only to the current owner's encrypted
   kind `24200` frames. `activeAgentTurnsStore` derives a live turn id, timing,
   and liveness summary; `agentFleet.ts` may display only a safe tool/lifecycle
   descriptor label. It must never display observer payloads, prompts, plans,
   tool arguments/results, or channel names in the fleet.
3. `get_agent_usage_series` reads the current identity + relay's local
   kind-`44200` archive across the last seven local calendar days. The desktop
   fleet labels token/model values as **reported**, cost as a **reported
   estimate**, and preserves unavailable or partial values rather than showing
   a zero. It does not total cost across the fleet and does not claim any value
   is an actual bill.
4. Activity navigation continues through `useOpenAgentActivity`, which checks
   that the viewer can open a channel before routing. The fleet intentionally
   opens the generic activity surface and never carries a channel id.
5. The Local archive setting remains the sole control for metric collection.
   When it is off, the fleet explains that only local archiving enables usage
   history and links to Settings → Local archive.

Primary files:

- `desktop/src/features/agents/ui/AgentsView.tsx`
- `desktop/src/features/agents/ui/AgentFleetSection.tsx`
- `desktop/src/features/agents/useAgentFleet.ts`
- `desktop/src/features/agents/lib/agentFleet.ts`
- `desktop/src/features/agents/observerRelayStore.ts`
- `desktop/src/features/agents/activeAgentTurnsStore.ts`
- `desktop/src/shared/api/tauriArchive.ts`

### Mention an agent

1. Candidate identity is assembled in `useMentions.ts` from channel members,
   managed agents, the hosted directory, and profile results.
2. `relayAgentIsSharedWithUser` makes the access decision. Directory name wins
   over stale channel/profile names.
3. `useMentionSendFlow.ts` identifies eligible agents missing from the channel.
4. Owner/admin send adds them through `add_channel_members` with role `bot`.
5. `send_channel_message` includes agent pubkeys as `p` tags.
6. The web client mirrors this in `useAgentMentionDelivery.ts` using
   `addWorkspaceMember` and `sendWorkspaceMessage`. Its composer assembles
   mention candidates from agents plus channel members in
   `workspace-mention-policy.ts` (`WorkspaceComposer.tsx` typeahead).
7. A kind `40003` edit that adds `p` tags delivers the *delta* mentions:
   `handle_stream_message_edit` (`buzz-relay/src/handlers/side_effects.rs`)
   computes edit-minus-target pubkeys and `Db::apply_message_edit_index`
   writes `event_mentions` rows keyed to the target message (and sets the
   target's `edited_content` so FTS indexes the edited body). Already-tagged
   pubkeys are never re-notified.

### Run an agent-targeted workflow step

1. `RelayActionSink` resolves exact `@Name` mentions against destination-channel
   members and checks the stored immutable agent-owner binding.
2. If at least one target is a managed agent, the relay persists and fans out a
   relay-only kind `46008` task rather than a visible kind `9` instruction.
3. `buzz-acp` subscribes to kind `46008` in mention mode. Its inbound owner gate
   uses the relay-asserted `actor` only for this relay-only kind; ordinary event
   authorization remains signer-based.
4. The task prompt suppresses acknowledgements, progress chatter, and direct
   `buzz messages send` calls. The harness captures `agent_message_chunk`
   output and publishes the final text as an agent-authored top-level kind `9`
   message in the task's `h` channel.
5. The result carries `workflow-result=<task-event-id>`, `buzz:workflow`,
   `workflow-run`, and `workflow-step` tags for traceability. If the model ends
   without text, the harness publishes a concise failure status instead of
   silently completing.

Primary files:

- `crates/buzz-relay/src/workflow_sink.rs`
- `crates/buzz-core/src/kind.rs`
- `crates/buzz-acp/src/lib.rs`
- `crates/buzz-acp/src/queue.rs`
- `crates/buzz-acp/src/acp.rs`
- `crates/buzz-acp/src/pool.rs`

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

Relay-generated workflow announcements remain signed by the relay key but carry
the workflow owner's pubkey in `actor`, the stable workflow UUID in
`buzz:workflow`, and the trusted display name in `workflow-name`. Web clients
must present these as workflow automation, not as an unnamed relay user; the
signing pubkey remains authoritative for edit/delete ownership checks.

Agent-targeted workflow steps use relay-only kind `46008` instead of kind `9`.
These control-plane events carry `p` targets plus `h`, `actor`, workflow, run,
and step correlation tags and never render in channel timelines. `buzz-acp`
authorizes the trusted `actor`, prompts the addressed managed agent, captures
its ACP final message, and publishes exactly one agent-authored top-level kind
`9` result tagged with `workflow-result`. Ordinary workflow messages without a
managed-agent target retain the visible announcement behavior.
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
| Web `['workspace-agents', viewerPubkey]` | Merged browser agent directory plus trusted controller runtime state | Immediate invalidation on live kind `10100`, `30180`, `30181`, namespaced `30177`, or `13534`, plus local hosted presentation/runtime publication and identity/community change. |
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

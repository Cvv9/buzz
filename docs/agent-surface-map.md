# Agent surface map

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
| Hosted agent directory | kind `10100` (`KIND_AGENT_PROFILE`) | Agent | Base hosted identity, owner, access tier, audience, response policy, channels, status, capabilities, desired/default model, and signed runtime model catalog. |
| Persona definition | kind `30175` (`KIND_PERSONA`) | Owner | Durable persona name, avatar, behavior, provider, model, runtime, and sharing definition for managed agents. |
| Team definition | kind `30176` (`KIND_TEAM`) | Owner | Owner-private grouping of persona ids. |
| Managed-agent projection | kind `30177` (`KIND_MANAGED_AGENT`) | Owner | Public, secret-free managed-agent projection keyed by agent pubkey. Also supports the namespaced compatibility form `hosted-agent:<pubkey>` on older relays. |
| Team catalog | kind `30178` (`KIND_TEAM_CATALOG`) | Owner | Shareable team projection with embedded public persona projections. |
| Hosted admin override | kind `30179` (`KIND_HOSTED_AGENT_CONFIG`) | Community owner/admin or declared agent owner | Current hosted name, avatar, and desired model. Newest authorized head wins over kind `10100` and kind `0`. |
| Channel membership | NIP-29 membership events; channel state uses `h` tags, membership addressables use `d` tags | Channel owner/admin | Determines whether an agent is already in a channel. It does not determine whether a shared agent is discoverable before its first invitation. |
| Channel catalog section | Relay `channels.catalog_section`, emitted as kind `39000` `catalog_section` tag | Channel owner/admin or community owner/admin via kind `9007`/`9002` | Shared web/desktop organization. It is not a local sidebar preference. An empty value explicitly clears the section. |
| Agent channel-add admission | Community-scoped `users.agent_owner_pubkey` plus `users.channel_add_policy` | Relay-authenticated agent or root operator | Owner mapping is immutable. `buzz-admin set-agent-owner` atomically ensures both principals, binds the owner, and sets `owner_only`; it never opens an `anyone` window. |
| Message author | message event `pubkey` | Sender | Stable identity reference for timeline and Inbox. Presentation is resolved at render time. |
| Local managed record | desktop encrypted/local managed-agent store | Agent owner | Runtime command, secrets, environment, lifecycle and local instance fields that must never enter public projections. |
| Global agent defaults | desktop local configuration | Current desktop user | Defaults only. Per-agent settings override them. |

### Field rules

| Field | Canonical read |
| --- | --- |
| Hosted name/avatar | Authorized kind `30179` override, then kind `10100`, then kind `0`. Desktop projection: `getHostedAgentPresentation` / `overlayHostedAgentProfiles`. Web projection: `applyHostedAgentConfigs`. |
| Managed name/avatar | Managed record plus its persona definition; kind `0` is republished for compatibility. Cache invalidation must follow successful edits. |
| Hosted model options | Signed `models` catalog from kind `10100`; never a frontend provider/model table. |
| Hosted selected model | Authorized kind `30179` desired model. A live save also sends observer `switch_model` to known agent channels. |
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

Primary files:

- `crates/buzz-admin/src/main.rs`
- `crates/buzz-db/src/user.rs`
- `crates/buzz-db/src/lib.rs`

### Edit a hosted agent

1. Desktop `/agents` opens `HostedAgentEditDialog.tsx`.
2. `publishHostedAgentConfig` signs kind `30179`; an old relay that reports an
   unknown kind receives the namespaced kind `30177` compatibility projection.
3. `list_relay_agents` and web `listAgents` select the newest authorized head
   and merge it onto kind `10100`.
4. The relay-agent query is invalidated/refetched.
5. If a model was selected, the desktop sends `switch_model` control to every
   known channel for that agent.
6. Rosters, profiles, search, mentions, messages, and Inbox resolve the merged
   name/avatar/model by pubkey.

Primary files:

- `desktop/src/features/agents/ui/HostedAgentEditDialog.tsx`
- `desktop/src/features/agents/lib/hostedAgentConfig.ts`
- `desktop/src-tauri/src/commands/agent_discovery.rs`
- `desktop/src/features/agents/lib/hostedAgentPresentation.ts`
- `web/src/features/workspace/workspace-api.ts`

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
   heads. Desktop and web refetch those heads, so neither client owns a second
   catalog.
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
2. Web queries and subscribes to that exact author/tag coordinate after the
   browser identity is unlocked, validates/decrypts the newest event, and
   applies the contained appearance to its root theme provider.
3. The event is encrypted to the author. A browser identity with a different
   pubkey cannot read it and must keep the default appearance rather than
   inheriting a different user's look.

Primary files:

- `desktop/src/shared/theme/communityThemePreference.ts`
- `desktop/src/shared/theme/communityThemeSync.ts`
- `web/src/shared/theme/CommunityThemeController.tsx`
- `web/src/shared/theme/community-theme.ts`

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
- `/repos`
- `/repos/$repoId`
- `/repos/$repoId/blob/$`

The browser workspace consumes the same relay events but does not share the
desktop TypeScript bundle. Any change to event shape, precedence, access, or
mention delivery must therefore update and test both clients explicitly.

## Cache and refresh boundaries

| Cache/query | What it contains | Required invalidation |
| --- | --- | --- |
| `relayAgentsQueryKey` | Merged kind `10100` plus authorized kind `30179`/compat configuration | Hosted identity/model/access edits; community switch. |
| `managedAgentsQueryKey` | Local managed instances | Managed create/edit/delete and runtime lifecycle changes. |
| `['user-profile', pubkey]` | Kind `0` profile | Profile or managed presentation update. |
| `['users-batch-entry', pubkey]` and `['users-batch', ...]` | Timeline, member, Inbox profile projection | Evict entry before invalidating aggregate queries after name/avatar changes. |
| Channel members/details | Membership and member presentation | Add/remove role changes and managed identity edits. |
| Web `['workspace-agents', viewerPubkey]` | Merged browser agent directory | Hosted config publication and identity/community change. |
| Web `['workspace-channels', viewerPubkey]` | Membership projection | Agent auto-add and explicit add/remove. |
| Web/desktop channel detail and list queries | Relay kind `39000` channel metadata, including `catalog_section` | Channel metadata, catalog section, archive/visibility, and membership mutations. |

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
- Relay ingest and agent-discovery tests — accepted kinds, authorization, and
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
4. Relay-agent discovery polls because kind `10100` and kind `30179` do not yet
   drive one unified desktop invalidation event. Realtime invalidation would
   reduce stale windows and repeated manual refreshes.
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

# Durable hosted-agent runtime settings

**Date:** 2026-08-30
**Status:** Draft for written-spec approval
**Scope:** Buzz web, relay, `buzz-acp`, hosted-agent deployment, and runtime controller

## Problem

The hosted-agent editor currently publishes kind `30180`, a public presentation
document. Its `model` field records a desired value but does not change the
running ACP adapter. The web projection then overlays that desired value onto
the signed kind `10100` runtime profile, so the UI can claim a model that the
agent is not using.

Production evidence on 2026-08-30 showed the mismatch: all nine hosted runners
reported `gpt-5.6-terra`, while several browser-authored kind `30180` records
requested Luna or Sol. The selector also combines model and reasoning effort in
one long list, and model changes can target an in-flight per-channel session.

The repeated model names are not evidence that several models run at once. ACP
`session/new` can advertise choices through both legacy `configOptions` and
unstable `models.availableModels`; the current merge path removes only identical
IDs, so distinct IDs or aliases with the same human label survive. Codex also
encodes effort variants in selection IDs, while the stable-catalog entrypoint
reads legacy `displayName` even when an adapter reports `name`. Those
representation bugs create repeated labels and lost effort distinctions around
one actual session selection.

This design makes model, reasoning effort, and runtime display name durable,
per-agent defaults. It gives the browser truthful pending/applied state without
turning a public event into a deployment control plane.

## Product decisions

1. Every hosted agent has its own global default model and reasoning effort.
2. Every channel, scheduled report, workflow, and ad hoc task for that agent
   uses those defaults. There are no per-channel, per-workflow, or per-message
   overrides.
3. The UI exposes separate **Model** and **Reasoning effort** selectors.
4. A change never interrupts active work. The agent finishes every in-flight
   turn, applies the latest queued revision, and only then starts queued work.
5. Hosted-agent changes are owner-only. For now, the authorized principal is
   exactly the current owner recorded for the deployment community. The policy has an
   extension point for future administrator/co-founder roles, but those roles
   are not enabled by this change.
6. A browser publication is a request, not proof of application. The UI says
   **Applied** only after it receives a matching controller status and a signed
   agent runtime acknowledgment.
7. A presentation name changes in the web directory immediately after relay
   acceptance, but the name used by the runtime changes at the same safe idle
   boundary as model and effort. Avatar changes are presentation-only.

## Selected architecture

Use a trusted host-side runtime controller with queued live application. The
runner keeps its relay connection and inbound queue, finishes every active turn,
then atomically replaces its agent-global defaults and sessions before
dispatching more work.

```mermaid
sequenceDiagram
  participant Owner
  participant Web
  participant Relay
  participant Controller
  participant Agent as buzz-acp runner

  Owner->>Web: Save name/model/effort
  Web->>Relay: kind 30180 presentation update
  Web->>Relay: encrypted kind 24201 runtime request
  Relay->>Relay: verify community owner and controller route
  Relay-->>Controller: authorized request
  Controller->>Controller: validate catalog, allocate revision, persist
  Controller->>Relay: signed kind 30181 pending/applying status
  Controller->>Agent: encrypted kind 24200 apply command
  Agent->>Agent: quiesce after active turns
  Agent->>Agent: replace defaults; recreate every ACP session
  Agent->>Relay: signed kind 10100 runtime acknowledgment
  Controller->>Relay: signed kind 30181 applied status
  Relay-->>Web: live status + profile update
```

The controller is a separate, non-promptable service. It does not expose a
Docker socket to an agent and does not accept executable paths, images,
credentials, environment variables, or arbitrary model IDs from the browser.

This is an intentional, user-approved tension with the remote-agent vision's
statement that new model settings take effect only on the next body. Here a
healthy body may reconfigure between turns so queued work and scheduled reports
are not lost during a process handoff. The stronger parts of that vision remain:
the desktop retains no substrate control channel, every request flows through
the relay, and the controller never kills or recreates a container directly.

## Sources of truth

| Concern | Authoritative source | Notes |
| --- | --- | --- |
| Community owner | Relay community record | Exact current owner only in this release; an audited ownership transfer changes the principal. |
| Hosted agent ownership/binding | Relay `users.agent_owner_pubkey` mapping | Immutable within the community; remains relevant to other agent policy. |
| Name and avatar shown in clients | Authorized kind `30180`, then signed kind `10100`, then kind `0` | Existing presentation precedence remains. |
| Current runtime model, effort, and runtime name | Agent-signed kind `10100.runtime` | Never replaced by a browser overlay. |
| Pending/application/failure state | Controller-signed kind `30181` | Trusted only from the controller pubkey advertised by the relay. |
| Allowed model/effort combinations | Agent-signed normalized catalog whose digest is acknowledged by the controller | Browser tables are never authoritative. |
| Durable desired runtime revision | Root-only controller state | Replayed after controller or agent restart. |

## Event and discovery contracts

### Relay discovery

The deployment relay advertises this NIP-11 extension:

```json
{
  "buzz_hosted_agent_runtime": {
    "version": 1,
    "controller_pubkey": "<64-char hex>",
    "request_kind": 24201,
    "status_kind": 30181
  }
}
```

The web client hides runtime controls unless this extension is present and the
controller has published a valid status for the target agent. A client must not
learn a controller key from an untrusted event.

### Kind `30180`: presentation compatibility

The existing exact schema `buzz.hosted-agent-config.v1` stays unchanged during
migration:

```json
{
  "schema": "buzz.hosted-agent-config.v1",
  "agent_pubkey": "<agent>",
  "name": "Market Intelligence",
  "avatar_url": "https://… or null",
  "model": "<legacy desired model or null>"
}
```

The `model` key is retained only because v1 requires the exact shape. New
clients preserve its existing value during presentation edits and never use it
as effective or pending runtime truth. Runtime-selector saves do not publish
kind `30180`. A later, separately migrated schema may remove the legacy field.

For hosted agents, relay ingest is tightened so kind `30180` is accepted only
from the current community owner. Non-hosted profile behavior is unaffected.

### Kind `24201`: encrypted runtime request

Add `KIND_HOSTED_AGENT_RUNTIME_REQUEST = 24201`. It is ephemeral, p-gated, and
never persisted by the relay. Required tags are exactly:

- one `p=<controller pubkey>` tag;
- one `agent=<agent pubkey>` tag;
- one `request=<UUID v4>` tag;
- one `expiration=<unix seconds>` tag no more than five minutes ahead.

The NIP-44-encrypted payload is:

```json
{
  "schema": "buzz.hosted-agent-runtime-request.v1",
  "request_id": "<same UUID as tag>",
  "agent_pubkey": "<same agent as tag>",
  "model": "gpt-5.6-terra",
  "effort": "high",
  "presentation_event_id": "<accepted kind 30180 event id or null>",
  "catalog_digest": "<sha256 of normalized signed catalog>"
}
```

`model` is a base model ID and `effort` is one of `low`, `medium`, `high`,
`xhigh`, `max`, or `ultra`. The pair must exist in the catalog; neither value is
passed through to a shell.

The relay accepts the request only when all of the following hold:

- the author is exactly the current deployment community owner in relay state;
- the `p` tag matches the configured controller pubkey;
- the target is a current self-authored kind `10100` agent in that community;
- the event is fresh, unexpired, correctly tagged, and validly signed;
- the request ID has not already been accepted inside the replay window.

The relay cannot inspect the encrypted choices. The controller repeats all
payload, owner, community, target, freshness, digest, and allowlist checks after
decryption. Browser retries reuse the same request ID and are idempotent.

### Kind `30181`: controller status

Add `KIND_HOSTED_AGENT_RUNTIME_STATUS = 30181`. It is a public,
parameterized-replaceable, secret-free controller snapshot with
`d=<agent pubkey>`. Only the controller pubkey advertised by NIP-11 is trusted.

```json
{
  "schema": "buzz.hosted-agent-runtime-status.v1",
  "agent_pubkey": "<agent>",
  "request_id": "<UUID or null>",
  "revision": 12,
  "state": "current | pending_busy | applying | applied | failed",
  "effective": {
    "model": "gpt-5.6-terra",
    "effort": "medium",
    "runtime_name": "Market Intelligence"
  },
  "requested": {
    "model": "gpt-5.6-sol",
    "effort": "high",
    "runtime_name": "Market Intelligence"
  },
  "catalog_digest": "<sha256>",
  "error": {
    "code": "unsupported_selection",
    "message": "This model and effort combination is not available."
  }
}
```

`requested` and `error` are nullable. Error text is from a fixed redacted
vocabulary. Status events never contain credentials, host paths, service names,
raw adapter output, or prompts.

### Kind `10100`: signed runtime acknowledgment

Keep the existing top-level profile compatible and add:

```json
{
  "runtime": {
    "schema": "buzz.agent-runtime.v1",
    "controller_pubkey": "<controller>",
    "revision": 12,
    "model": "gpt-5.6-sol",
    "effort": "high",
    "effective_name": "Market Intelligence",
    "catalog_digest": "<sha256>"
  },
  "model_families": [
    {
      "id": "gpt-5.6-sol",
      "name": "GPT-5.6-Sol",
      "description": "Latest frontier agentic coding model.",
      "default_effort": "medium",
      "efforts": ["low", "medium", "high", "xhigh", "max", "ultra"]
    }
  ]
}
```

The current flat `models` array remains during compatibility. The entrypoint
normalizer accepts adapter `name` and legacy `displayName`, retains
descriptions, and derives `model_families` from exact adapter options such as
`gpt-5.6-sol[high]`. It canonicalizes entries from `configOptions` and
`models.availableModels` by `(base model, effort)` and follows the ACP harness's
verified method priority when both surfaces advertise the same selection. A
family is selectable only when its exact adapter binding and at least one
recognized effort have been probed successfully; pseudo-options such as
“Runtime default” are never treated as model families. The controller keeps the
private mapping from a validated `(base model, effort)` pair to its ACP method
and exact adapter selection ID.

The controller marks revision `N` applied only when a fresh self-authored kind
`10100` reports the same controller pubkey, revision, model, effort, runtime
name, and catalog digest. Stale or mismatched acknowledgments are ignored.

## Controller state and reconciliation

The controller stores an atomically replaced, root-readable-only state file at
`/var/lib/varvik-suite/buzz-runtime-controller/state.json`. Each agent entry
contains its fixed agent pubkey, fixed service identity, desired revision,
effective revision, validated model/effort pair, runtime name, catalog digest,
and request status. It contains no browser-supplied command fragments.

On a valid request, the controller:

1. resolves the agent through its fixed deployment mapping;
2. fetches the accepted presentation event when one is referenced;
3. validates model and effort against the latest signed catalog and its own
   runtime probe;
4. increments the per-agent revision and fsyncs the new desired state;
5. publishes `pending_busy` or `applying` status;
6. sends an encrypted `apply_runtime_defaults` control frame to the runner;
7. waits for the runner's exact signed kind `10100` acknowledgment;
8. records and publishes `applied`, or keeps the prior effective revision and
   publishes a redacted `failed` status.

On startup and reconnect, it compares desired state, controller status, and
agent acknowledgment. Any non-applied highest revision is replayed
idempotently. This is how a browser choice survives both controller and runner
restarts without baking the choice into Compose environment variables.

The controller records an append-only local audit entry for accepted,
superseded, applied, and failed revisions. A newer request supersedes an older
pending revision. If an older revision is already applying, the controller
finishes reconciling it and immediately applies the newer desired revision
before allowing new turns.

## Runner state machine

When `BUZZ_ACP_RUNTIME_CONTROLLER_PUBKEY` is configured, hosted runtime changes
are accepted only as encrypted controller-authored kind `24200` frames. Direct
owner `switch_model` controls are rejected with `managed_by_controller`; this
prevents a per-channel, non-durable bypass.

```text
CURRENT
  -> request accepted
QUIESCING
  -> stop starting queued turns
  -> wait for active_turn_count == 0
APPLYING
  -> set global desired model + effort + runtime name
  -> discard every idle ACP session
  -> create/probe one fresh session and verify exact selection
  -> publish kind 10100 revision acknowledgment
CURRENT
  -> resume queued turns
```

An active turn is a prompt batch that has been claimed by the pool and has not
yet returned, errored, or timed out. An open but idle ACP session is not active.
If several channels are active, all finish before application. Once quiescing
starts, new messages may be accepted from the relay but are not dispatched to
the adapter until application succeeds or rolls back. They remain in the same
in-memory queue, so the settings boundary neither drops nor replays a scheduled
report.

The controller never cancels an active turn merely because an application
deadline expires. A long-running turn remains `pending_busy` and triggers an
operational alert. On validation or adapter-application failure, the runner
restores the prior defaults, discards any partially changed probe session,
publishes the prior effective acknowledgment plus an encrypted failure receipt,
and resumes queued work. The controller then publishes the redacted failed
snapshot.

All future scheduled reports and workflows use the same per-agent defaults
because session creation reads only the agent-global desired revision. No task
source is allowed to supply its own model or effort.

## Web interaction design

The agent editor shows two controls:

- **Model**: one option per base model family, with its signed description;
- **Reasoning effort**: only efforts supported by the selected model.

The card also shows **Current runtime** and, when different, **Pending change**.
The save button is disabled while the current viewer is not the current
community owner or while the catalog/controller trust chain is unavailable.

Status language is exact:

- `current`: no requested change;
- `pending_busy`: “Queued — applies after current work finishes”;
- `applying`: “Applying to new sessions”;
- `applied`: “Applied” with model, effort, name, and revision;
- `failed`: fixed actionable error plus a retry action.

Saving a name/avatar first waits for relay acceptance of kind `30180`. A name
change then submits a runtime reconcile request referencing that event. The
directory name/avatar update live across open browsers immediately; the card
continues to disclose the runtime-name pending state until acknowledgment.
Avatar does not alter an agent prompt and requires no runtime request.

The old `applyHostedAgentConfigs` behavior that overwrites `profile.model` is
removed. Selectors initialize from signed effective runtime plus controller
pending state, never from `30180.model`.

## Authorization and future RBAC

All hosted-agent mutation paths call one relay policy function with the action
and target. In v1 it returns true only for the current community owner.
Presentation, runtime request, hosted-agent channel membership, and hosted
agent archive/delete actions use that function. Ordinary channel moderation is
not silently tightened.

The function accepts a future role source but v1 has no administrator or
co-founder grants. Adding such roles requires a new explicit policy migration,
audit coverage, and UI disclosure; no event-authored role string can grant
itself authority.

## Failure handling

| Failure | Result |
| --- | --- |
| Unsupported or stale catalog selection | Reject before changing desired state; current runtime is unchanged. |
| Controller unavailable | Browser times out to a retryable “Controller unavailable”; no applied claim. |
| Agent busy | Persist and show `pending_busy`; do not interrupt. |
| Agent disconnect/restart | Retain desired revision and replay after a fresh profile appears. |
| Adapter rejects selection | Restore prior effective defaults and publish `failed`. |
| Mismatched/stale acknowledgment | Ignore it and continue reconciliation. |
| Newer request arrives | Highest revision wins; superseded request is audit-only. |
| Browser closes | Controller status and durable state continue; another browser resumes from kind `30181`. |

## Deployment design

1. Add the controller as a separate Compose/system service on the business
   host with its own Nostr key and root-only state volume.
2. Pin its pubkey in relay configuration and every hosted runner through
   `BUZZ_ACP_RUNTIME_CONTROLLER_PUBKEY`.
3. Enable the existing observer transport for each runner without exposing the
   owner or controller private keys to the runner.
4. Deploy relay and controller compatibility first, then a single canary agent,
   then the remaining fleet.
5. Keep provider selection out of this change. The current fleet remains
   Codex-only; this design controls model and reasoning effort within the
   installed adapter.

No full PWA or desktop packaging work is required. The production target is the
browser client served at `buzz.varvikstudios.com`; desktop consumers receive
compatibility parsing and truthful display fixes where they share the same
agent contracts.

## Required tests

### Relay and core

- Kind constants, ephemeral/replaceable classification, and explicit query
  allowlists for `24201` and `30181`.
- Reject malformed tags, plaintext content, stale/expired requests, replayed
  IDs, wrong controller, non-owner authors, cross-community targets, and agents
  without a current self-authored profile.
- Accept exactly one owner-authored valid request and fan it only to the pinned
  controller.
- Accept status only from the configured controller and validate its exact
  secret-free schema.
- Enforce owner-only hosted-agent presentation and hosted membership mutation.

### Controller

- Catalog normalization and digest stability, including `name` versus legacy
  `displayName` and duplicate flat model options.
- `(model, effort)` allowlist mapping with no shell interpolation.
- Atomic persistence, request idempotency, monotonic revisions, supersession,
  restart reconciliation, redacted errors, and mismatched-ack rejection.
- Agent offline, controller restart, and runner restart scenarios.

### `buzz-acp`

- Idle application replaces every session and affects every later channel.
- One and multiple active turns finish without cancellation; queued turns wait
  and start with the new defaults.
- Model and effort are applied together or rolled back together.
- A name update changes the next session/runtime profile without changing the
  signing identity.
- Direct hosted `switch_model` is rejected when controller management is on.
- Crash restart and controller replay produce the exact signed revision
  acknowledgment without losing the durable selection.

### Web and desktop compatibility

- Separate selectors, supported-effort filtering, owner-only disabled states,
  keyboard/accessibility behavior, and responsive layout.
- `30180.model` never overwrites current runtime display.
- Current/pending/applying/applied/failed live transitions survive reload and a
  second browser session.
- Name/avatar presentation propagation and delayed runtime-name acknowledgment.
- No duplicate base-model rows for effort variants.

### Production acceptance

Use a dedicated hosted canary identity. While it runs a deliberately blocked
task, request a different model and effort and prove the task is not cancelled.
After completion, prove the next message and one scheduled report publish a
kind `10100` acknowledgment and runtime evidence for the new pair. Restart the
runner, repeat a message, and prove the setting persisted. Restore the canary's
original pair before fleet rollout.

## Documentation updates required with implementation

- `docs/agent-surface-map.md`
- `docs/hosted-agent-runtime-control.md`
- `VISION_AGENTS.md` or the relevant agent vision document
- relay/web/ACP testing runbooks and deployment environment examples

## Out of scope

- Switching ACP providers or credential sets.
- Per-task, per-channel, or per-workflow model overrides.
- Force-cancelling work to accelerate a settings change.
- Enabling admin/co-founder RBAC in this release.
- Turning the web client into an offline-installable PWA.

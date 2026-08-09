# Hosted-agent runtime control

## Current production boundary

The browser can edit a hosted agent's public presentation through kind
`30180`.  That event deliberately has the exact, secret-free shape:

```json
{
  "schema": "buzz.hosted-agent-config.v1",
  "agent_pubkey": "<agent pubkey>",
  "name": "<display name>",
  "avatar_url": "<url or null>",
  "model": "<desired model or null>"
}
```

It must **not** be extended to include a provider, command, credential
reference, runtime image, environment value, or lifecycle instruction.  It is
replicated publicly and is authorized for either a community administrator or
the declared agent owner.  It is therefore not a secure deployment-control
plane.

The currently deployed VarVik hosted fleet is Codex-only:

- `applications/business/buzz-agents.compose.yml` fixes
  `BUZZ_ACP_AGENT_COMMAND=codex-acp` and mounts only Codex credentials.
- the `agent-runtime` Docker target installs only `codex-acp`.
- `deploy/compose/agent-entrypoint.sh` copies only the Codex auth state into
  the running agent's home directory.
- shared agents do not currently set `BUZZ_ACP_AGENT_OWNER` or
  `BUZZ_ACP_RELAY_OBSERVER`; no browser-originated live control can be
  authenticated for them.

`buzz-acp` does support both `codex-acp` and `claude-agent-acp`, and it can
apply a `switch_model` observer control to a current adapter session.  That
control is intentionally in-memory, per channel, and is lost after a harness
restart.  It cannot replace an adapter or safely make a model preference
durable.

## Required security invariants

1. A browser must never choose an executable path, Docker image, environment
   variable, credential file, or arbitrary model string.
2. A provider's process must never receive another provider's credential
   mount.  Installing both adapters and mounting both account states in one
   promptable agent container is not an acceptable shortcut.
3. Runtime changes are allowed only for the immutable declared owner of that
   agent, not merely for a community administrator who may edit its public
   presentation.
4. The execution host, not the relay or browser, owns service names, allowed
   providers, credential mounts, restarts, and durable override storage.
5. The UI shows a model only after the controller has proved that provider and
   model are available.  A front-end provider/model table is not authoritative.
6. A change is acknowledged only after the replacement runner publishes its
   signed kind `10100` profile with the expected runtime and catalog.

## Smallest safe architecture

Add a small, host-resident **hosted-agent runtime controller**.  It is a
separate privileged deployment component, never part of a promptable agent
container and never granted a Docker socket through the relay.

```mermaid
sequenceDiagram
  participant Owner as "Declared agent owner"
  participant Web as "Buzz Web/Desktop"
  participant Relay as "Buzz relay"
  participant Controller as "Host runtime controller"
  participant Runner as "Codex or Claude agent service"

  Owner->>Web: "Choose provider + model"
  Web->>Relay: "Encrypted runtime request"
  Relay->>Relay: "Verify owner binding and target"
  Relay->>Controller: "Authorized request"
  Controller->>Controller: "Validate allowlist/catalog; persist private override"
  Controller->>Runner: "Recreate only mapped provider service"
  Runner->>Relay: "Signed 10100 runtime/profile catalog"
  Relay->>Web: "Live directory update"
```

The request should be a new encrypted, short-lived runtime-control event, not
kind `30180` and not a broad HTTP endpoint.  The relay validates all of these
before fan-out:

- exactly one `p=<controller pubkey>` and one `agent=<agent pubkey>` tag;
- a NIP-44 payload, fresh timestamp, and a random request id;
- sender is the immutable owner recorded for the target agent;
- agent belongs to the controller's configured community.

The controller decrypts the request and applies this bounded payload:

```json
{
  "version": 1,
  "request_id": "uuid",
  "agent_pubkey": "<agent pubkey>",
  "provider": "codex | claude",
  "model": "one controller-advertised model id"
}
```

It maps the agent pubkey to a fixed service pair and provider-specific Compose
profile.  It writes the selected provider/model to a root-only state file,
stops the previous provider service, starts the mapped replacement, and waits
for the expected signed `10100` profile.  A timeout rolls the service back and
emits a redacted failure receipt.  The controller also publishes the signed,
non-secret provider/model availability catalog consumed by web and desktop.

Each provider-specific service has its own immutable credential/config mounts
and uses the same agent key only while its counterpart is stopped.  This
preserves message identity without placing two providers' credentials in the
same agent process.

## Delivery slices

1. **Truthful model UI now:** retain the existing live kind `10100` model
   dropdown, label it as a current-adapter selection, and only offer a live
   switch after the target has an owner binding and relay observer enabled.
   If the adapter has no active session, show that the change applies on the
   next session and does not survive restart.  Do not claim that the `30180`
   field changes the runner.
2. **Controller foundation:** add the new relay event envelope/authorization,
   controller key, root-only override store, service mapping, audit receipts,
   and controller integration tests.
3. **Codex provider lane:** move each current service to the controller's
   Codex profile, enable the required owner bindings, and verify a restart plus
   kind `10100` catalog acknowledgment.
4. **Claude provider lane:** install the Claude ACP adapter in its isolated
   image/profile; provision and validate a permitted server-side Claude
   authentication method; add its catalog health check; then enable it per
   agent.
5. **Browser/Desktop selector:** consume only controller-signed availability,
   submit the encrypted request, render pending/applied/rolled-back receipts,
   and never expose credential fields.

Before enabling the Claude lane, verify that the selected Claude subscription
or API agreement permits unattended hosted use for this deployment.  A local
interactive subscription login is not, by itself, a deployment credential
contract.

## Required tests

- Relay rejects malformed, stale, replayed, non-owner, wrong-controller, and
  cross-community requests.
- Controller rejects unknown agent/provider/model mappings without starting a
  process.
- A provider switch stops the old service before the new service starts and
  never mounts the other provider's credential path.
- A missing or mismatched `10100` runtime acknowledgment rolls back.
- The web selector hides unavailable providers and never publishes runtime
  data in kind `30180`.
- Current-adapter `switch_model` remains covered separately and is marked
  non-durable until the controller owns persistence.

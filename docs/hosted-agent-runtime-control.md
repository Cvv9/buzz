# Hosted-agent runtime control

Buzz's browser workspace, including an installed browser PWA, is the only
runtime-settings control surface. The desktop client may display compatibility
state but does not own a second mutation path.

Each hosted agent has one atomic default made of:

- base model family;
- reasoning effort supported by that family; and
- runtime-facing name.

That default applies to every future task for that agent. Tasks, channels,
workflows, and individual messages cannot override it. When work is active, a
new revision remains `pending_busy`; the runner accepts more queued messages but
does not start them, does not cancel an active turn, and does not change the
active session. It emits `applying` only after every active turn finishes and
publishes `applied` only after a fresh-session probe and an exact signed agent
acknowledgment.

## Trust and data boundaries

The community owner signs and NIP-44 encrypts kind `24201` to the controller
pubkey advertised by relay NIP-11. The controller repeats the owner, target,
freshness, request UUID, expiration, catalog digest, and allowlist checks before
persisting anything. It then sends an encrypted kind `24200` control frame to
the exact agent. Public kind `30181` contains only strict status vocabulary;
private service names, ACP binding IDs, host paths, commands, prompts, adapter
output, and secret values are forbidden.

Agent and controller services deliberately do not use Compose `env_file`; doing
so would inject every relay/database/object-store secret from `.env` into those
containers. Compose substitution passes only each service's explicit allowlist.

The agent's signed kind `10100.runtime` acknowledgment plus the pinned
controller's kind `30181` are runtime truth. Kind `30180.model` is legacy
presentation data and is never treated as effective runtime.

## Compose configuration

Set these values in `deploy/compose/.env` before starting either hosted-agent
profile:

```dotenv
BUZZ_RUNTIME_CONTROLLER_PRIVATE_KEY=<dedicated 64-character secret hex>
BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY=<matching lowercase public hex>
BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON=<one-line strict JSON array>
```

The private key is injected only into `runtime-controller`. The relay and agent
containers receive only `BUZZ_HOSTED_AGENT_RUNTIME_CONTROLLER_PUBKEY`. Agent
containers never receive the controller private key, relay private key, or a
Docker socket.

Generate a dedicated controller identity with `buzz-admin generate-key`. Do not
reuse the relay, owner, or any agent identity. The controller validates that the
configured public pin belongs to its private key before connecting.

Every mapped agent identity must already be a relay member. Add it from the
trusted relay/operator environment before starting the agent profile. Managed
runners set `BUZZ_ACP_SKIP_MEMBER_BOOTSTRAP=true` and therefore never receive or
use `BUZZ_RELAY_PRIVATE_KEY`.

`BUZZ_RUNTIME_CONTROLLER_AGENTS_JSON` is a fixed allowlist. Each entry has this
shape:

```json
{
  "agent_pubkey": "<lowercase 64-character agent pubkey>",
  "service": "agent-market-intelligence",
  "catalog": {
    "model_families": [
      {
        "id": "gpt-5.6-terra",
        "name": "GPT-5.6-Terra",
        "description": "Balanced agentic coding model.",
        "default_effort": "medium",
        "efforts": ["low", "medium", "high", "xhigh", "max", "ultra"]
      }
    ],
    "bindings": [
      {
        "model": "gpt-5.6-terra",
        "effort": "medium",
        "method": {
          "type": "set_model",
          "model_id": "gpt-5.6-terra[medium]"
        }
      }
    ]
  },
  "initial_runtime": {
    "model": "gpt-5.6-terra",
    "effort": "medium",
    "runtime_name": "Market Intelligence"
  }
}
```

Use each runner's `buzz-acp models --json` output as the source of
`canonical.catalog` and its persisted identity file as the source of
`agent_pubkey`. Do not infer binding IDs from labels. Repeated labels such as
`GPT-3.5-Turbo-16k` can represent aliases; Buzz publishes one normalized family
row while retaining the exact selected binding only in this private mapping.
The signed agent profile publishes `model_families` and `catalog_digest`, never
the binding list.

## Start and health

```bash
cd deploy/compose
./run.sh start-agents
# or
./run.sh start-personal-agents
```

Compose waits for the relay and the controller's independent readiness endpoint.
`run.sh` also verifies that every enabled runner container is still running.
The controller becomes ready only after authentication, complete agent-profile
replay, subscriptions, state recovery, and pending-revision replay.

On a fresh controller volume, every allowlisted agent receives bootstrap
revision 1. This deliberate reconciliation produces the first exact signed
acknowledgment and opens the runner's startup dispatch gate. Scheduled reports
must not run before that boundary.

Personal assistants use the runner's daily heartbeat schedule configured by
`BUZZ_ACP_BRIEF_UTC_HOUR` and `BUZZ_ACP_BRIEF_UTC_MINUTE`. Shared portfolio or
weekly reports are Buzz workflow schedules, not implicit agent heartbeats; test
and monitor those workflow definitions separately.

## Status interpretation

| State | Meaning | Operator action |
|---|---|---|
| `current` | No requested revision differs from effective | None |
| `pending_busy` | Durable; active work is draining or the runner is offline | Wait; investigate if it exceeds the alert window |
| `applying` | Runner reached idle and is probing a fresh session | Wait briefly |
| `applied` | Exact agent acknowledgment matches revision, selection, name, controller, and digest | None |
| `failed` | Prior effective runtime remains active | Use the fixed error code; refresh/retry or inspect private runner logs |

Alert on controller readiness failure, a runner container not running,
`pending_busy` longer than the maximum active-turn duration, `applying` longer
than the adapter probe timeout, repeated fixed failure codes, or a missing daily
report after its configured UTC window. Never copy raw adapter output into a
public status or audit event.

## Canary rollout

`./run.sh upgrade-runtime` deploys compatibility in this order:

1. relay;
2. runtime controller;
3. `agent-market-intelligence` canary;
4. remaining enabled agent fleet.

The command intentionally stops after step 3 unless
`BUZZ_RUNTIME_CANARY_APPROVED=true` is set. Before approving, start a blocked
canary task, save a different model and effort in the browser, verify the task
finishes without a cancellation or duplicate terminal result, and verify the
status sequence and next queued task. Restart the controller and runner
separately and confirm the selection survives. Restore the canary's original
runtime before fleet rollout.

## State recovery and rollback

Controller state and redacted JSONL audit live in the
`buzz-runtime-controller-state` volume. Files are written with mode `0600`; the
directory is mode `0700`. State writes use a sibling temp file, file fsync,
atomic rename, and directory fsync where supported. Recovery reads only the
complete canonical state file and ignores a partial temp file.

Back up the controller volume with the same maintenance window as relay data.
To restore, stop the controller, restore the last complete state and audit files
with root-only permissions, and restart it. Pending/applying revisions are
replayed idempotently. Do not edit revision numbers or request UUID indexes by
hand.

For software rollback, keep the controller state volume, redeploy the previous
relay/controller/runner images, and restore the canary's original runtime in the
browser. Never delete state merely to clear a failed status; that discards
idempotency and revision history.

## Controller key rotation

1. Stop accepting runtime edits and wait for no pending/applying revisions.
2. Back up the controller volume and audit log.
3. Generate a dedicated replacement keypair.
4. Deploy relay compatibility with the new public pin and a new empty controller
   state volume, then deploy the new controller.
5. Roll one runner with the new public pin. Its bootstrap revision establishes a
   new acknowledgment bound to the replacement controller.
6. Complete canary acceptance, roll all runners, then resume browser edits.
7. Retain the old audit/state backup according to audit policy and destroy the
   old private key only after rollback is no longer required.

Never run old and new controllers against the same public pin or reuse the old
state file under a different controller identity.

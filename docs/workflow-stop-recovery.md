# Recovering positively verified stopped workflow attempts

This operation belongs on the trusted Docker deployment host. It uses the relay's
pinned hosted-runtime controller key, not an agent key or a delegated credential.
It never starts a provider or refunds an accepted manual run.

Keep the old container stopped. Do not remove it until recovery is acknowledged,
and never restart it after issuing a stop attestation. A missing container is not
proof of stop: the command requires a fresh `docker inspect` showing the exact
full container ID, `exited`, PID zero, and no running/restarting/paused state.

1. Identify the old container by its immutable 64-character ID. Stop it using the
   deployment's normal operator procedure. The recovery command does not stop a
   container on your behalf.
2. Create a JSON request with the exact public community/controller/agent IDs and
   original run, task, grant, instance, channel and ordinal from the protected
   harness journal. Use this shape:

```json
{
  "version": 1,
  "community_id": "<community UUID>",
  "controller_pubkey": "<pinned controller hex>",
  "target_agent": "<agent hex>",
  "container_id": "<full stopped container ID>",
  "evidence_id": "0000000000000000000000000000000000000000000000000000000000000000",
  "observed_at": 0,
  "container_started_at": 0,
  "container_finished_at": 0,
  "operation": {
    "op": "verified_attempt_stopped",
    "run_id": "<run UUID>",
    "task_id": "<task UUID>",
    "grant_id": "<grant UUID>",
    "instance_id": "<original instance UUID>",
    "channel_id": "<channel UUID>",
    "ordinal": 1
  }
}
```

3. Load the controller's existing private environment using the deployment's
   trusted credential procedure, then run:

```sh
buzz workflows recover --request recovery.json \
  --container <full-container-id> --audit recovery-audit.json
```

The command copies identity and journal from that exact container into a private
0700 temporary directory with 0600 files. Identity contents are parsed as data,
never executed. It derives the public identity, verifies the exact journal grant,
rechecks the stopped container, and fills the timestamp/hash evidence fields.
The new audit file contains only public evidence and the signed recovery event;
it is fsynced before publication. Copied secrets are removed before publication.
The transport preserves exact signed bytes for its retries. Keep the audit for
an uncertain-delivery investigation rather than inventing a new reset request.

The relay checks the pinned signer and host community, strict tags, 90-second
freshness, exact original grant/task/target/instance/ordinal and container lifetime.
The stop and durable audit commit together under the execution lock. Revoked
channel access does not prevent acknowledgement of the original exact grant;
it does prevent new work. Exact event replay does not consume another attempt.

For legacy scheduled dispatches with persisted task rows, the operation can be
`{"op":"legacy_recovery","tasks":[{"run_id":"…","task_id":"…","channel_id":"…","task_event_id":"…"}],"claims":[]}`.
Each target requires verified stopped-container evidence. The relay requires
matching relay-authored kind46008 run/target/channel evidence, completed dispatch,
and no execution grant. Other unresolved targets retain the run's overlap fence.
Taskless migrated runs and orphan scheduler claims lack the necessary immutable
evidence and remain blocked with a safe unsupported-evidence reason. Current
workflow bindings, elapsed time, and a new capability heartbeat cannot clear them.

# Telegram approval receipts and start acknowledgment

**Date:** 2026-08-30
**Status:** Approved by owner request
**Scope:** `Sylars_Work_Manager` Telegram bridge, Buzz command intake, Sylars task state, deployment, and production acceptance

## Problem

The Telegram approval bridge currently has three separate user-visible failures:

1. Inbound Telegram updates are fetched only on the shared bridge poll interval,
   which defaults to 60 seconds, while `getUpdates` itself uses `timeout: 0`.
   A button press can therefore sit unseen for almost a minute.
2. The Confirm callback is not answered until after the bridge fetches the task
   and publishes a signed Buzz event. Telegram keeps showing its busy spinner
   during that entire network path.
3. A successful Buzz publication is the end of the Telegram flow. The operator
   is not shown a durable chat receipt for the action they sent, and the bridge
   never follows the task until Sylars accepts the exact command and starts or
   queues work.

There are already uncommitted bridge changes that add an inline Confirm button
bound to the original Telegram user and chat. Those changes are preserved and
completed; they are not reverted.

## Product contract

Telegram remains a keyboard for Buzz, not an independent approval authority.
The bridge still holds only its own allowlisted Buzz signing key and the
read/submit-scoped Sylars API token. It never receives an approval API token.

The approval experience has four truthful stages:

1. **Approve tapped:** Telegram immediately opens the existing Confirm step.
2. **Confirm tapped:** the callback spinner stops within one second with
   “Sending approval…”. This is local acceptance, not a claim that Buzz or
   Sylars accepted it.
3. **Buzz accepted:** a normal chat message says
   `✅ Approval sent for <task>. Waiting for Sylars to acknowledge.` The receipt
   is sent only after Buzz returns a valid event ID.
4. **Sylars acknowledged:** the bridge matches that exact Buzz event ID against
   Sylars command-receipt state. It then sends either:
   - `✅ Sylars accepted the approval. Task queued.` when capacity delays work;
   - `▶️ Sylars accepted the approval and started work.` when running;
   - a fixed actionable rejection/failure message; or
   - `⚠️ Approval was sent, but Sylars has not acknowledged it yet. Check Buzz.`
     after the bounded acknowledgment deadline.

If an accepted task is first queued and later starts, Telegram sends the start
message exactly once. If the first observed acknowledged state is already
running, it sends only the combined started message. Deny, steer, and cancel
receive the same “sent” plus exact-command acknowledgment discipline with
action-appropriate wording.

## Latency and polling design

- Telegram inbound uses one non-overlapping long-poll loop with a Bot API
  timeout of 25 seconds. A completed long poll starts the next immediately.
- Approval-card/digest discovery retains its separate 60-second cadence.
- Pending action receipts use a separate two-second reconciliation cadence.
- No interval may start a second `getUpdates` request while one is in flight.
- Shutdown aborts or drains the long poll before the server exits.

This removes the accidental 60-second input latency without turning outbound
task polling into a hot loop.

## Durable action receipt

After Buzz accepts a command, the bridge persists this secret-free record in
`bridge-state.json` before presenting it as sent:

```json
{
  "task_id": "SWM-20260830-ABCD1234",
  "action": "approve",
  "buzz_event_id": "<64 hex>",
  "chat_id": "<configured private chat>",
  "submitted_at": "2026-08-30T12:00:00Z",
  "deadline_at": "2026-08-30T12:02:00Z",
  "stage": "buzz_sent | sylars_accepted | started | terminal | timed_out"
}
```

No instruction, diff, token, private key, or full task body is stored. Pending
records survive bridge restart. Finished records remain as a bounded dedupe
window so the same acceptance/start message is not emitted twice.

Before Buzz publication the bridge journals a local `sending` reservation. If
it restarts in the ambiguous send window, it first queries Sylars for a receipt
or changed task state. It does not blindly post a second approval. A retry is
allowed only after the reconciliation grace period proves the task is still at
the original approval state with no matching receipt.

## Sylars command-receipt contract

`sylars-control` records a bounded, public-safe command receipt on the task for
every Buzz command it processes:

```json
{
  "event_id": "<exact Buzz event id>",
  "action": "approve",
  "result": "accepted | rejected",
  "task_status": "queued | running | publishing | denied | cancelled | awaiting_approval",
  "at": "2026-08-30T12:00:03Z",
  "code": "accepted | stale_base | stale_knowledge | invalid_state | unauthorized | internal_error"
}
```

Receipts are written transactionally with an accepted state transition. A
rejected command is also recorded against its exact source event ID with a
fixed code; raw stack traces, repository paths, credentials, and untrusted
provider text are not exposed. The task's existing detailed audit remains the
operator's durable diagnostic record.

## Button and message behavior

- Confirm callbacks are answered before `fetchTask` or `buzz.sendReply`.
- The original inline keyboard is removed or disabled after a single-use
  action is claimed.
- A failed Buzz send produces a normal chat failure message and a retry button
  only when the reservation can safely be retried.
- Repeated taps, replayed nonces, wrong user/chat, expired confirmations, and
  duplicate Telegram updates never publish another command or duplicate a
  receipt.
- Callback toasts are short status hints; durable outcomes are normal Telegram
  chat messages.
- Messages name the task and action but do not include full Buzz event IDs,
  instructions, diffs, or secrets.

## Failure behavior

| Failure | Telegram result |
| --- | --- |
| Telegram callback answer fails | Continue the safe command path and send a normal chat result if possible. |
| Task lookup fails before Buzz send | “Approval was not sent” with a retryable fixed reason. |
| Buzz rejects or times out | “Approval was not sent to Buzz” and keep/release the reservation according to reconciliation state. |
| Sylars rejects exact event | Show the fixed rejection reason; never claim queued or started. |
| Sylars remains unchanged through deadline | Show the bounded not-acknowledged warning once and retain audit state. |
| Bridge restarts | Resume pending receipt reconciliation without duplicate chat messages or commands. |
| Task completes before next poll | Send one combined accepted/completed acknowledgment, not stale queued/running messages. |

## Required tests

- Confirm callback is answered before any task fetch or Buzz call and inside the
  one-second logical deadline.
- Long polling is non-overlapping and independent from outbound discovery.
- Valid Buzz event ID produces one “sent” message; invalid/missing event ID does
  not.
- Exact command receipt drives queued, running, rejected, terminal, and timeout
  messages with no duplicates.
- Queued then running emits two ordered receipts; directly running emits one
  combined receipt.
- Restart between reservation, Buzz send, Sylars acceptance, and running
  resumes safely at every boundary.
- Wrong user/chat, expired or replayed nonce, duplicate update, and simultaneous
  confirmation cannot publish twice.
- Deny, steer, and cancel use the same receipt machinery.
- A production canary proves Confirm responsiveness, exact Buzz publication,
  exact Sylars command receipt, work-start message, and dedupe after bridge
  restart.

## Deployment acceptance

Deploy `sylars-control` command receipts before the updated Telegram bridge.
Use a dedicated no-op/canary task that pauses for approval and has no external
side effect. Measure callback answer, Buzz-sent message, Sylars acceptance, and
work-start timestamps. Restart the bridge while a second canary is pending and
prove it resumes without duplicate approval or chat messages. Do not use a
real production change as the acceptance task.

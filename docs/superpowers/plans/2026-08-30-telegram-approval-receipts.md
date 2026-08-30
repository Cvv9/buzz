# Telegram Approval Receipts Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development to implement this cross-repository plan without overwriting the existing uncommitted Confirm-button work.

**Goal:** Make Telegram approval actions responsive, visibly receipted, and followed through to an exact Sylars acceptance and work-start acknowledgment.

**Architecture:** Telegram callbacks are acknowledged immediately, then the bridge posts the signed Buzz command, journals the returned event ID, and reconciles it against a new bounded `sylars-control` command-receipt record. Separate non-overlapping long-poll, outbound-discovery, and two-second receipt loops eliminate the 60-second input delay while preserving the existing Buzz approval authority.

**Tech Stack:** Node.js 22 ESM, Node test runner, Telegram Bot API, Buzz CLI/Nostr events, Sylars REST read API, atomic JSON state, Docker Compose, GitHub Actions Azure VM deployment.

**Spec:** `docs/superpowers/specs/2026-08-30-telegram-approval-receipts-design.md`

**Global Constraints:** Implementation files live in sibling repository `../Sylars_Work_Manager`; operational documentation also lives in `../varvik-suite`. Preserve the current uncommitted edits in `telegram-bridge/bridge.mjs` and `telegram-bridge/bridge.test.mjs`. Telegram remains a signed Buzz keyboard and never receives `SYLARS_APPROVAL_API_TOKEN`. Callback toasts are not durable receipts. Never claim Sylars accepted or started work without the exact returned Buzz event ID appearing in Sylars command-receipt state. Do not approve a real external change for testing. Each task starts with a failing test, observes the failure, makes the smallest implementation, observes the pass, and commits with DCO signoff in the repository that owns the files.

---

## Task 1: Preserve the inline Confirm work and pin current behavior

**Files:**

- Modify: `../Sylars_Work_Manager/telegram-bridge/bridge.test.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/bridge.mjs`

1. Record the existing diff and run `npm test --prefix telegram-bridge` before editing. The current Confirm-button, same-user/chat binding, single-use nonce, and typed fallback tests must remain.
2. Add failing order assertions proving `answerCallbackQuery("Sending approval…")` occurs before `fetchTask` and `buzz.sendReply`, and a normal chat receipt occurs only after Buzz returns a valid event ID.
3. Add failing tests for Buzz lookup/send failure, invalid event ID, repeated confirm, simultaneous confirm calls, keyboard removal, and exact “not sent” versus “sent, awaiting Sylars” wording.
4. Run `npm test --prefix telegram-bridge -- --test-name-pattern="Confirm|receipt"` from the Sylars repository and observe failures.
5. Refactor the existing Confirm path without reverting it: claim the single-use confirmation, answer the callback immediately, disable the keyboard, fetch/post, then emit a durable chat message. Normalize the Buzz publisher result to one validated `event_id`.
6. Re-run the focused and full Telegram bridge tests.
7. Commit the reconciled existing diff plus this task with `git commit -s -m "fix(telegram): acknowledge approval sends immediately"`.

## Task 2: Replace interval polling with non-overlapping Telegram long polling

**Files:**

- Modify: `../Sylars_Work_Manager/telegram-bridge/telegram-client.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/telegram-client.test.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/server.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/server.test.mjs`

1. Add failing client tests requiring `getUpdates` to send `timeout: 25`, the saved offset, and allowed update types. Add abort-signal coverage.
2. Add fake-clock server tests proving only one `getUpdates` is in flight, completion schedules the next immediately, a transient failure backs off without waiting 60 seconds, outbound discovery remains on its own cadence, and shutdown aborts/drains the long poll.
3. Run the focused Telegram client/server tests and observe failures.
4. Implement a recursive asynchronous long-poll loop instead of `setInterval`. Add `TELEGRAM_LONG_POLL_TIMEOUT_SECONDS=25` and `TELEGRAM_LONG_POLL_RETRY_MS=1000` with bounded validation; keep `BRIDGE_POLL_INTERVAL_MS` only for outbound cards/digests.
5. Re-run focused and full bridge tests.
6. Commit with `git commit -s -m "fix(telegram): use continuous long polling"`.

## Task 3: Add exact Buzz command receipts to Sylars task state

**Files:**

- Modify: `../Sylars_Work_Manager/sylars-control/control.mjs`
- Modify: `../Sylars_Work_Manager/sylars-control/task-manager.mjs`
- Modify: `../Sylars_Work_Manager/sylars-control/task-manager.test.mjs`
- Modify: `../Sylars_Work_Manager/sylars-control/server.test.mjs`

1. Add failing tests that an accepted Buzz approve/deny/steer/cancel records `{eventId,action,result:"accepted",taskStatus,at,code:"accepted"}` in a bounded `commandReceipts` list transactionally with the state change.
2. Add failing tests that stale base, stale project intelligence, invalid state, unauthorized command, and internal failure record an exact-event rejected receipt with a fixed safe code and no raw stack/path/credential text.
3. Add idempotency tests: replaying the same Buzz event returns the same receipt; a different event cannot make an already-applied approval look newly accepted.
4. Run `npm test --prefix sylars-control -- --test-name-pattern="command receipt|Buzz approve"` and observe failures.
5. Implement a bounded 20-entry receipt ring and include its secret-free shape in `publicTask`. Write accepted receipts inside the existing transactions. Wrap `handleBuzzEvent` so a rejected action writes its receipt before the existing Buzz error reply.
6. Re-run focused and full `sylars-control` tests.
7. Commit with `git commit -s -m "feat(sylars): expose exact command receipts"`.

## Task 4: Persist pending Telegram actions and reconcile acknowledgments

**Files:**

- Modify: `../Sylars_Work_Manager/telegram-bridge/bridge.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/bridge.test.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/server.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/server.test.mjs`

1. Add failing state-machine tests for `sending`, `buzz_sent`, `sylars_accepted`, `started`, `terminal`, and `timed_out` stages. Cover approve, deny, steer, and cancel.
2. Assert queued then running produces two ordered messages, directly running produces one combined message, rejection produces no queued/started claim, terminal-before-poll produces one combined terminal receipt, and deadline produces one warning.
3. Add restart tests at every boundary. An ambiguous `sending` reservation must reconcile the task before any retry; a persisted exact Buzz event ID must never be reposted.
4. Run focused bridge tests and observe failures.
5. Implement a strict secret-free pending-action schema in `bridge-state.json`, bounded completed-action dedupe history, and `reconcilePendingActions`. Match only `commandReceipts.eventId === buzzEventId` and the same action.
6. Persist the `sending` reservation before Buzz publication, the returned event ID before the “sent” chat message, and every delivered acknowledgment stage before emitting the next stage.
7. Re-run focused/full bridge tests twice to prove persisted dedupe.
8. Commit with `git commit -s -m "feat(telegram): follow approvals through work start"`.

## Task 5: Run receipt reconciliation on an independent fast cadence

**Files:**

- Modify: `../Sylars_Work_Manager/telegram-bridge/server.mjs`
- Modify: `../Sylars_Work_Manager/telegram-bridge/server.test.mjs`
- Modify: `../Sylars_Work_Manager/.env.example`
- Modify: `../Sylars_Work_Manager/docker-compose.yml`

1. Add failing fake-clock tests requiring a two-second default receipt cadence, no overlapping reconciliation calls, retry backoff, no Sylars API token escalation, and clean shutdown.
2. Add health assertions for long-poll state, pending action count, oldest pending age, last receipt poll, and last fixed error code without exposing task content or credentials.
3. Run focused server tests and observe failures.
4. Add `TELEGRAM_RECEIPT_POLL_INTERVAL_MS=2000` and `TELEGRAM_ACTION_ACK_TIMEOUT_MS=120000`, validate bounds, and run a separate non-overlapping receipt loop. Keep the existing 60-second outbound cadence.
5. Wire only the existing `SYLARS_CONTROL_API_TOKEN`; assert Compose contains no approval token in the Telegram service.
6. Re-run bridge tests and `docker compose config` with non-secret test values.
7. Commit with `git commit -s -m "feat(telegram): monitor action acknowledgments"`.

## Task 6: Add a full mocked Telegram-to-Buzz-to-Sylars round trip

**Files:**

- Create: `../Sylars_Work_Manager/telegram-bridge/approval-roundtrip.test.mjs`
- Modify: `../Sylars_Work_Manager/.github/workflows/deploy.yml`

1. Write a failing integration test with fake Telegram Bot API, fake Buzz publisher, and real in-memory `TaskManager`: card, Approve, Confirm, immediate callback, Buzz-sent receipt, exact command ingestion, queued/running acknowledgment, completion, and duplicate-update replay.
2. Assert callback acknowledgment precedes every simulated network delay and total logical acceptance remains below one second.
3. Add failure variants for Buzz rejection, Sylars rejected receipt, bridge restart after Buzz send, and task queued behind capacity.
4. Run the new integration test and observe failures before connecting the components.
5. Add it to the deploy workflow's predeployment gate alongside the existing Telegram and Sylars suites.
6. Run all `telegram-bridge`, `sylars-control`, and new round-trip tests.
7. Commit with `git commit -s -m "test(telegram): cover approval round trip"`.

## Task 7: Update operator documentation and observability

**Files:**

- Modify: `../Sylars_Work_Manager/README.md`
- Modify: `../Sylars_Work_Manager/docs/BUZZ_CONTROL.md`
- Modify: `../varvik-suite/docs/TELEGRAM_BRIDGE.md`
- Modify: `../varvik-suite/system-maps/data/ops_system.json`

1. Document the four receipt stages, exact messages, latency targets, long-poll/receipt environment variables, health fields, timeout/retry behavior, and restart recovery.
2. Document that “sent to Buzz” is transport acceptance, while “Sylars accepted” and “started work” require exact command-receipt/state evidence.
3. Update the system map's Telegram flow to include the returned Buzz event ID and acknowledgement reconciliation without changing its approval-authority statement.
4. Run the VarVik Suite documentation/system-map checks and the Sylars documentation checks used by CI.
5. Commit Sylars docs with `git commit -s -m "docs(telegram): describe approval receipts"`; commit VarVik Suite docs separately with `git commit -s -m "docs(ops): map Telegram acknowledgments"`.

## Task 8: Deploy and prove the production Telegram flow

**Files:**

- Create: `../Sylars_Work_Manager/artifacts/telegram-approval-acceptance-2026-08-30.json`

1. Run fresh unit/integration tests, syntax checks, Compose validation, and deployment workflow gates. Record exact outputs before deployment.
2. Deploy `sylars-control` first and verify command receipts through a read-only task query. Deploy the Telegram bridge second and verify health reports active long polling and zero stale pending actions.
3. Create a dedicated no-op canary task that pauses before an action with no external side effect. Tap Approve and Confirm; record callback-answer, Buzz-sent, Sylars-accepted, and work-start timestamps and exact event/task IDs.
4. Verify one approval Buzz event, one accepted command receipt, and one start acknowledgment. Repeat with a queued canary and prove queued then started ordering.
5. Restart the bridge after a second canary's Buzz-sent stage and prove reconciliation resumes without another Buzz command or duplicate Telegram message.
6. Exercise a deliberate safe rejection and prove Telegram shows rejection rather than started. Do not use a production repository push, deployment, credential, destructive action, or customer communication.
7. Store only secret-free acceptance evidence, run the full post-deploy health checks, and commit with `git commit -s -m "test(telegram): record production acceptance"`.

## Plan self-review checklist

- The callback spinner, Buzz transport receipt, Sylars acceptance, queue state, and work start are distinct truthful states.
- Inbound Telegram latency is independent from the 60-second outbound card cadence.
- Exact Buzz event IDs correlate commands; task status alone cannot falsely acknowledge a different approver.
- Existing uncommitted Confirm-button edits are preserved and completed.
- Approve, deny, steer, and cancel share durable, restart-safe receipt machinery.
- Telegram never receives an approval credential and remains a signed Buzz keyboard.
- Tests cover replay, concurrency, restart, rejection, timeout, queued work, and direct running.
- Production acceptance uses only no-op canaries and contains no secret or business payload.

# Manual agent workflow trigger build log

Product and technical design approved on 2026-09-20. Base: Buzz `cc00949b9`; Suite `dcb2856`.

## Phase 1 — Durable admission and authoritative association

Implementation complete. Independent re-review PASS, functional QA PASS, and root build/test/static gate PASS. Signed phase commit follows.

- Isolated Postgres and Redis prepared on localhost ports 55441 and 56441. Locked JavaScript dependencies restored; baseline web and desktop typechecks pass.
- Reclaimed only regenerable Buzz incremental artifacts and unused Docker build cache to restore build disk headroom; application volumes retained.
- Suite seed slice: immutable scheduled agent bindings implemented. Initial review found a quoted-YAML-key retargeting bypass; executor added a behavioral regression and fixed it. Re-review PASS, independent QA PASS with additional malformed-value regression coverage. Root reran 193 Suite tests, Python compile, diff checks and 16-service/66-value validation: PASS. Signed Suite commit `264007d`; not published yet because it requires the matching Buzz schema/runtime release.
- Factual design clarification: existing workflow executor rejects cross-channel `send_message` overrides, so the supported manual profile preserves that restriction rather than widening authority.
- Runtime feasibility clarification: separate Linux supervisor/worker UIDs and stripped child capabilities are required; same-UID environment scrubbing alone cannot protect the full agent key. Dummy-credential isolation probe passed; release-image proof remains required (see DESIGN.md).
- Phase 2 verification notes: an ACP `end_turn` alone is not proof of useful output when an adapter reports application errors as message text. Also ensure permission revocation stops new work without making previously granted, strictly bounded stopped acknowledgments impossible; otherwise use the explicitly trusted recovery path for verified termination.

- Phase 1 ledger retention adaptation approved by the parent planner: workflow deletion with accepted manual history archives/tombstones the definition, preserves active tasks/outbox/receipts/allowances, and rejects same-ID resurrection. Definitions also retain tombstones while scheduled execution or scheduled claims remain unresolved; only definitions without protected history or unresolved work retain physical deletion. Tests cover active-delete and delete/recreate; community erasure remains governed by the existing deletion fence and explicit table inventory.
- Phase 1 contract: normal workflow dispatch status remains separate from actual execution state. Scheduled agent tasks currently record `stalled/legacy_execution_unknown`; old unfinished claims with no linked run also block manual admission. Phase 2 must positively verify old runner/process stopping before clearing this evidence; capability freshness or timestamps alone are insufficient. The relay's version-1 capability handler is deliberately closed until scoped credentials, process isolation, claims and stopping evidence are implemented. Manual admission writes signed task intent only to a durable outbox, never the ordinary executor or ten-retry conversation queue.

- Phase 1 independent review required three fixes: preserve unresolved scheduled evidence across deletion, return unknown for interval next-run previews without a real scheduler anchor, and allowlist agent-summary history fields to exclude raw traces/errors. Scheduler cadence is unchanged. Tooling deviation: new reviewer agent creation hit the thread limit, so the existing design agent performed the independent read-only review.

- Phase 1 final gate: root built relay and CLI, reran all 14 isolated manual DB tests, and passed all-target clippy for the six changed crates plus workspace formatting/diff checks. Two equivalent-expression lint fixes were applied by the executor and the complete static command rerun successfully. QA used the existing executor in an independent verification role because new agent creation remained unavailable; QA added the actual process-death and immutable rejection regressions. No runtime capability is enabled by this phase.

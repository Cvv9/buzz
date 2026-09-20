# PRD: Run Scheduled Agent Workflows from Agent Settings

## Problem
Buzz already supports scheduled, channel-scoped workflows and manual workflow commands, but agent settings do not give an operator a clear way to find and rerun an agent's daily work after an incident. Existing manual command deduplication does not prevent repeated, distinct requests from consuming agent capacity and provider credits. Workflow dispatch completion also does not prove that the downstream agent finished its brief, so a recovery control needs trustworthy execution status and shared safeguards.

## Users
- **Hosted-agent operator:** Finds an agent's scheduled workflows, starts a fresh run after a repair, and sees the outcome and when another run is permitted.
- **Community members:** Continue receiving workflow results in their existing channels; cannot gain operator privileges or see private workflow details through the new controls.
- **Infrastructure operator:** Can distinguish rejected requests, active work, completed results, and stalled execution without exposing prompts or credentials.

## Success Metrics
- An authorized operator can find and request an eligible scheduled workflow within two interactions after opening agent settings.
- In a test of 100 concurrent or repeated requests across clients, accepted runs never exceed the configured concurrency, cooldown, or rolling limits; rejected requests start zero agent work.
- Every accepted manual run has a durable requester, workflow, target agent, start time, and terminal outcome or explicit stalled state; dispatch alone never appears as completed agent work.
- Every manual run stops initiating new work by its 20-minute deadline and never exceeds two agent execution attempts, including retries and provider fallback.

## Requirements
- REQ-1 (MUST): Agent settings in web and desktop list the current hosted agent's scheduled workflows that the viewer may access. Each row shows the workflow name, destination channel, enabled/paused state, schedule with timezone, next scheduled time, latest actual execution outcome/time, and a labelled, keyboard-accessible **Run now** button. Unknown times and outcomes remain visibly unknown; empty, loading, and failed discovery have distinct states. Workflow association uses authoritative agent identity and remains correct after agent renaming.
- REQ-2 (MUST): Run now starts one fresh execution of the existing enabled workflow with its current configuration and normal destination, without changing its schedule, marking future scheduled occurrences as completed, replaying an old failed request, or resuming partially completed side effects. The operator can see before activation that this is a fresh run and may repeat prior actions. Paused, deleted, unsupported, or ambiguously associated workflows cannot be started and show the reason.
- REQ-3 (MUST): The server authorizes every read and manual execution. For the hosted settings control, the requester must be the exact current community owner and must also satisfy existing workflow ownership and channel permissions; agents must retain their existing target/channel admission checks. Other identities and communities cannot bypass these checks through UI, CLI, replayed commands, or direct requests. Permission loss is rechecked before work starts.
- REQ-4 (MUST): Admission is atomic and durable across reconnects, restarts, clients, and identities. Repeated delivery of the same request produces at most one execution and one quota charge. A workflow already queued or executing, whether scheduled or manually started, cannot receive an overlapping manual execution. A scheduled occurrence that collides with an active manual execution of the same workflow is recorded as skipped due to active work, without a catch-up run or a change to future cadence. Blocked manual requests are rejected with a reason, never silently queued for later.
- REQ-5 (MUST): Apply shared manual-run safeguards across every manual trigger surface: a 15-minute cooldown per workflow measured from accepted start; at most three accepted manual runs per workflow per rolling 24 hours; at most ten per community per rolling 24 hours; at most one active manual run per target agent and two per community. A workflow targeting multiple agents counts against each target's active limit. Failed accepted runs consume allowance; rejected requests do not. All applicable checks must pass together, and ordinary scheduled occurrences do not consume manual allowances. The UI shows remaining allowance and the next eligible time when time-based limits block execution.
- REQ-6 (MUST): A manual run has a 20-minute total lifetime from acceptance, including queued work, retries, and fallback, with at most two agent execution attempts in total. At expiry, the run cannot begin or retry any further work and active execution is cancelled. If stopping cannot be confirmed, show **Stalled — execution not confirmed stopped** and retain the concurrency block until confirmed stopped; never report successful cancellation or release the block solely because a timer expired. Existing provider selection/fallback remains applicable within these limits. These limits apply to every downstream agent task caused by the manual run, without changing unrelated conversations.
- REQ-7 (MUST): Show accepted/queued, running, completed, failed, timed out, and stalled states using actual downstream agent execution evidence. Completion requires every required targeted agent task to finish; publishing instructions or finishing workflow dispatch is insufficient. Concurrent views converge on the same state and remaining allowance. Preserve a permission-checked link to the result or safe failure reason, plus the requester and whether the run was manual or scheduled; do not expose hidden channel names, prompts, credentials, or another community's history.
- REQ-8 (MUST): Describe these controls as limits on manual execution, not a guaranteed monetary or subscription-credit budget. Do not show an estimated charge as a verified bill, assume missing usage is zero, or imply that automatic provider fallback is free. Before starting, show the applicable run limits and that the workflow uses the agent's configured provider and fallback.

## Non-Goals
- Creating or editing schedules, workflow steps, prompts, provider accounts, or agent runtime settings.
- A Run all button, bulk retries, bypass/force-run controls, automatic replay of historical failures, or unrestricted offline queueing.
- Mobile settings controls or local harness heartbeats that are not existing scheduled workflows.
- Resuming or undoing partially completed external actions, or promising exactly-once effects from external tools.
- Changing ordinary conversation limits or imposing the manual daily allowance on scheduled runs.
- Provider billing integration, a cross-provider currency ledger, reservation of subscription credits, or a guaranteed spending ceiling in this first release.

## Approval
The user approved this scope with “proceed” on 2026-09-20 after the proposed defaults and budget distinction were presented. All eight MUST requirements and the stated limits are approved. This release uses anti-spam controls and bounded execution; a hard monetary ceiling remains out of scope. The technical design was subsequently approved with “apprioved”.

## Open Questions
None at the product gate. Implementation feasibility and compatibility must be resolved in the technical design without silently weakening the approved limits.

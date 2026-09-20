import { Link } from "@tanstack/react-router";
import { Clock, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import {
  canRunScheduledWorkflow,
  manualWorkflowReason,
  workflowResultHref,
  type AgentScheduledWorkflow,
} from "@/features/workflows/workflow-policy";
import { useAgentScheduledWorkflows } from "../useAgentScheduledWorkflows";

/** Keep request state isolated when the viewer, community or selected agent changes. */
export function AgentScheduledWorkflows(props: {
  agentPubkey: string;
  viewerPubkey: string;
  canManage: boolean;
}) {
  return (
    <ScheduledWorkflowsPanel
      key={`${relayHttpBaseUrl()}:${props.viewerPubkey}:${props.agentPubkey}`}
      {...props}
    />
  );
}
function timeLabel(value: string | number): string {
  const time = typeof value === "number" ? value * 1000 : Date.parse(value);
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(time)} UTC`;
}
function remainingLabel(time: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(time) - now) / 1000));
  return seconds
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : "Awaiting relay eligibility refresh";
}
function ScheduledWorkflowsPanel({
  agentPubkey,
  viewerPubkey,
  canManage,
}: {
  agentPubkey: string;
  viewerPubkey: string;
  canManage: boolean;
}) {
  const state = useAgentScheduledWorkflows(
    agentPubkey,
    viewerPubkey,
    canManage,
  );
  return (
    <section
      aria-label="Scheduled workflows"
      className="mx-auto mt-8 max-w-2xl border-t border-border pt-6"
      data-testid="agent-scheduled-workflows"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Clock className="size-4" />
          Scheduled workflows
        </h2>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!state.online || state.query.isFetching}
            onClick={() => void state.refresh()}
            aria-label="Refresh scheduled workflows"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        ) : null}
      </div>
      {!canManage ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Only the current workspace owner can view and run scheduled agent
          workflows.
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Starts fresh and may repeat prior actions. Uses the configured
            provider and fallback. 20 minutes; two total attempts; 15-minute
            cooldown; 3/workflow/day, 10/workspace/day; 1 active/agent,
            2/workspace. These are execution limits, not a spending cap. Day
            allowances use a rolling 24-hour window.
          </p>
          {!state.online ? (
            <p role="status" className="mt-3 text-sm">
              Offline. No workflow requests are queued.
            </p>
          ) : !state.live ? (
            <p role="status" className="mt-3 text-sm">
              Connecting to the relay… Run controls remain unavailable until
              connected.
            </p>
          ) : null}
          {state.query.isPending ? (
            <p role="status" className="mt-4 text-sm">
              Loading scheduled workflows…
            </p>
          ) : state.query.isError ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {state.query.error.message} Run controls are unavailable until
              refreshed.
            </p>
          ) : state.rows.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No scheduled workflows are associated with this agent.
            </p>
          ) : null}
          <div className="mt-4 space-y-4">
            {!state.query.isError &&
              state.rows.map((row) => (
                <WorkflowRow
                  key={row.workflow_id}
                  row={row}
                  state={state}
                  viewerPubkey={viewerPubkey}
                />
              ))}
          </div>
          {!state.query.isError && state.query.hasNextPage ? (
            <Button
              type="button"
              className="mt-4"
              variant="outline"
              disabled={!state.online || state.query.isFetching}
              onClick={() => void state.query.fetchNextPage()}
            >
              Load more workflows
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
function WorkflowRow({
  row,
  state,
  viewerPubkey,
}: {
  row: AgentScheduledWorkflow;
  state: ReturnType<typeof useAgentScheduledWorkflows>;
  viewerPubkey: string;
}) {
  const request = state.requests[row.workflow_id];
  const acceptedUnreflected =
    request?.decision?.accepted &&
    row.last_run?.id !== request.decision.run_id &&
    (!row.last_run?.accepted_at ||
      Date.parse(row.last_run.accepted_at) <
        Date.parse(request.decision.limits.server_now));
  const disabled =
    !state.ready ||
    request?.pending ||
    acceptedUnreflected ||
    (!request?.retrySame && !canRunScheduledWorkflow(row));
  const last = row.last_run;
  const receiptLimits = request?.decision?.limits;
  const limits =
    receiptLimits &&
    Date.parse(receiptLimits.server_now) > Date.parse(row.limits.server_now)
      ? receiptLimits
      : row.limits;
  const requestReason =
    request?.decision?.accepted === false ? request.decision.reason : null;
  return (
    <article
      className="rounded-xl border border-border p-4"
      data-testid={`scheduled-workflow-${row.workflow_id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold">{row.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.enabled ? "Scheduled" : "Paused"} ·{" "}
            {row.schedule.cron
              ? `Cron ${row.schedule.cron}`
              : `Every ${row.schedule.interval}`}{" "}
            · UTC
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={Boolean(disabled)}
          aria-label={`${request?.retrySame ? "Retry same request for" : "Run now"} ${row.name}`}
          aria-describedby={`workflow-reason-${row.workflow_id}`}
          onClick={() => void state.run(row)}
        >
          {request?.pending
            ? "Requesting…"
            : request?.retrySame
              ? "Retry same request"
              : "Run now"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Next scheduled:{" "}
        {row.next_scheduled_at
          ? timeLabel(row.next_scheduled_at)
          : row.enabled
            ? "Unknown — no confirmed scheduler anchor"
            : "Paused"}
      </p>
      <p className="mt-2 text-xs">
        Remaining starts: {limits.remaining_workflow}/3 for this workflow ·{" "}
        {limits.remaining_community}/10 for this workspace (rolling 24 hours).
      </p>
      {limits.next_eligible_at ? (
        <p className="mt-1 text-xs">
          Next eligible: {timeLabel(limits.next_eligible_at)} ·{" "}
          {remainingLabel(limits.next_eligible_at, state.serverNow)}
        </p>
      ) : row.block_reason ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Next eligible time is unknown while work or readiness is blocked.
        </p>
      ) : null}
      <p
        id={`workflow-reason-${row.workflow_id}`}
        className="mt-2 text-xs text-muted-foreground"
      >
        {row.block_reason
          ? manualWorkflowReason(row.block_reason)
          : !row.enabled
            ? "This workflow is paused."
            : "The relay rechecks eligibility when you run it."}
      </p>
      {request?.pending ? (
        <p role="status" className="mt-2 text-sm">
          Requesting admission…
        </p>
      ) : null}
      {request?.decision?.accepted && acceptedUnreflected ? (
        <p role="status" className="mt-2 text-sm">
          Run accepted. Waiting for current execution status.
        </p>
      ) : null}
      {requestReason ? (
        <p role="status" className="mt-2 text-sm">
          Not started: {manualWorkflowReason(requestReason)}
        </p>
      ) : null}
      {request?.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {request.error}
        </p>
      ) : null}
      <div
        className="mt-3 border-t border-border pt-3 text-xs"
        aria-live="polite"
      >
        {last ? (
          <>
            <p className="font-medium">
              Last actual outcome:{" "}
              {last.execution_state === "unknown"
                ? "Unknown — no verified execution evidence"
                : last.execution_state.replace(/_/g, " ")}
            </p>
            <p className="mt-1 text-muted-foreground">
              {last.origin === "manual"
                ? "Manual run"
                : last.origin === "scheduled"
                  ? "Scheduled run"
                  : "Event-triggered run"}{" "}
              · {timeLabel(last.accepted_at ?? last.created_at)}
              {last.requester
                ? ` · Requested by ${last.requester === viewerPubkey ? "you" : truncatePubkey(last.requester)}`
                : ""}
            </p>
            {last.deadline_at &&
            ["queued", "running", "stalled"].includes(last.execution_state) ? (
              <p className="mt-1">
                Execution deadline: {timeLabel(last.deadline_at)}
              </p>
            ) : null}
            {last.safe_error_code ? (
              <p className="mt-1">
                {manualWorkflowReason(last.safe_error_code)}
              </p>
            ) : null}
            {last.results.map((result, index) => (
              <Link
                className="mt-2 mr-3 inline-block underline"
                key={result.event_id}
                to={workflowResultHref(result.channel_id, result.event_id)}
              >
                View result{last.results.length > 1 ? ` ${index + 1}` : ""}
              </Link>
            ))}
          </>
        ) : (
          <p className="text-muted-foreground">No previous run.</p>
        )}
      </div>
    </article>
  );
}

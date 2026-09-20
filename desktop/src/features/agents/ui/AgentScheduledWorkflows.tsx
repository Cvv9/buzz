import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Play, RefreshCw } from "lucide-react";
import type { useAgentScheduledWorkflows } from "@/features/workflows/agentScheduledWorkflowHooks";
import {
  MANUAL_WORKFLOW_COPY,
  manualWorkflowBlocked,
  manualWorkflowReason,
  safeWorkflowResult,
  workflowScheduleLabel,
} from "@/features/workflows/manualRunPolicy";
import type { Channel } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

function utc(time: number | null): string {
  return time === null
    ? "Unknown"
    : new Date(time).toLocaleString(undefined, {
        timeZone: "UTC",
        timeZoneName: "short",
      });
}

/** Authorized summaries only; ordinary history and provider diagnostics stay outside settings. */
export function AgentScheduledWorkflows({
  model,
  onNavigate,
  channels,
}: {
  model: ReturnType<typeof useAgentScheduledWorkflows>;
  onNavigate: () => void;
  channels: Channel[];
}) {
  const navigate = useNavigate();
  const { query, rows, connection, requests, refresh, run } = model;
  const [, tick] = React.useReducer((value) => value + 1, 0);
  // Display elapsed time against the server's last clock. It never grants eligibility.
  React.useEffect(() => {
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const online = connection === "connected" && navigator.onLine;
  return (
    <section
      aria-labelledby="scheduled-workflows-heading"
      className="space-y-3 border-t pt-4"
      data-testid="agent-scheduled-workflows"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium" id="scheduled-workflows-heading">
          Scheduled workflows
        </h3>
        <Button
          aria-label="Refresh scheduled workflows"
          disabled={!online || query.isFetching}
          onClick={refresh}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{MANUAL_WORKFLOW_COPY}</p>
      {!online ? (
        <p className="text-sm" role="status">
          Reconnect to load or run workflows. Nothing will be queued.
        </p>
      ) : null}
      {query.isPending && online ? (
        <p className="text-sm" role="status">
          Loading scheduled workflows…
        </p>
      ) : null}
      {query.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not refresh scheduled workflows. Check your access and try
          again.
        </p>
      ) : null}
      {query.isSuccess && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No scheduled workflows are connected to this agent.
        </p>
      ) : null}
      {(query.isError ? [] : rows).map((row) => {
        const request = requests.get(row.workflowId);
        const blocked = manualWorkflowBlocked(row);
        const receipt = request?.receipt;
        const limits =
          receipt && receipt.limits.serverNow > row.limits.serverNow
            ? receipt.limits
            : row.limits;
        const approximateNow =
          row.limits.serverNow + Math.max(0, Date.now() - query.dataUpdatedAt);
        const wait =
          limits.nextEligibleAt === null
            ? null
            : Math.max(
                0,
                Math.ceil((limits.nextEligibleAt - approximateNow) / 1000),
              );
        const results =
          row.lastRun?.results
            .map((result) => safeWorkflowResult(row.channelId, result))
            .filter((result) => result !== null) ?? [];
        const status = row.lastRun?.executionState ?? "No runs yet";
        const channelName = channels.find(
          (channel) => channel.id === row.channelId,
        )?.name;
        return (
          <article
            className="space-y-2 rounded-md border p-3"
            data-testid={`scheduled-workflow-${row.workflowId}`}
            key={row.workflowId}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h4 className="break-words text-sm font-medium">{row.name}</h4>
                <p className="text-xs text-muted-foreground">
                  {workflowScheduleLabel(row.schedule)} · UTC
                  {!row.enabled ? " · Paused" : ""}
                </p>
              </div>
              <Button
                aria-label={`${request?.uncertain ? "Retry same request for" : "Run now"} ${row.name}`}
                disabled={
                  !online ||
                  query.isError ||
                  query.isFetching ||
                  request?.pending ||
                  (!request?.uncertain && Boolean(blocked))
                }
                onClick={() => void run(row)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Play className="h-4 w-4" />
                {request?.pending
                  ? "Starting…"
                  : request?.uncertain
                    ? "Retry same request"
                    : "Run now"}
              </Button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {channelName ? (
                <>
                  <dt className="text-muted-foreground">Channel</dt>
                  <dd>#{channelName}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Next scheduled</dt>
              <dd>{utc(row.nextScheduledAt)}</dd>
              <dt className="text-muted-foreground">Last outcome</dt>
              <dd className="capitalize" data-testid="workflow-actual-outcome">
                {status.replaceAll("_", " ")}
              </dd>
              {row.lastRun?.deadlineAt &&
              ["queued", "running", "stalled"].includes(
                row.lastRun.executionState,
              ) ? (
                <>
                  <dt className="text-muted-foreground">Run deadline</dt>
                  <dd>{utc(row.lastRun.deadlineAt)}</dd>
                </>
              ) : null}
              {row.lastRun?.completedAt ? (
                <>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd>{utc(row.lastRun.completedAt)}</dd>
                </>
              ) : null}
              {row.lastRun?.origin ? (
                <>
                  <dt className="text-muted-foreground">Started by</dt>
                  <dd>
                    {row.lastRun.origin === "manual"
                      ? "Manual request"
                      : "Scheduled workflow"}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Remaining today</dt>
              <dd>
                {limits.remainingWorkflow}/3 workflow ·{" "}
                {limits.remainingCommunity}/10 workspace (rolling 24 hours)
              </dd>
              <dt className="text-muted-foreground">Next allowed</dt>
              <dd>
                {limits.nextEligibleAt === null
                  ? blocked
                    ? "Not currently available"
                    : "Available now"
                  : `${utc(limits.nextEligibleAt)}${wait && wait > 0 ? ` (about ${Math.ceil(wait / 60)} min)` : ""}`}
              </dd>
            </dl>
            <div aria-live="polite" className="space-y-1 text-xs">
              {blocked ? <p>{blocked}</p> : null}
              {row.lastRun?.safeErrorCode ? (
                <p>{manualWorkflowReason(row.lastRun.safeErrorCode)}</p>
              ) : null}
              {receipt && !receipt.accepted ? (
                <p>{manualWorkflowReason(receipt.reason)}</p>
              ) : null}
              {request?.message ? <p>{request.message}</p> : null}
            </div>
            {request?.uncertain ? (
              <Button
                disabled={!online || query.isFetching}
                onClick={refresh}
                size="sm"
                type="button"
                variant="ghost"
              >
                Check status
              </Button>
            ) : null}
            {results.map((result, index) => (
              <Button
                key={result.messageId}
                onClick={() => {
                  onNavigate();
                  void navigate({
                    to: "/channels/$channelId",
                    params: { channelId: result.channelId },
                    search: { messageId: result.messageId },
                  });
                }}
                size="sm"
                type="button"
                variant="link"
              >
                View result{results.length > 1 ? ` ${index + 1}` : ""}
              </Button>
            ))}
          </article>
        );
      })}
      {query.hasNextPage ? (
        <Button
          disabled={query.isFetching || !online}
          onClick={() => void query.fetchNextPage()}
          size="sm"
          type="button"
          variant="outline"
        >
          Load more workflows
        </Button>
      ) : null}
    </section>
  );
}

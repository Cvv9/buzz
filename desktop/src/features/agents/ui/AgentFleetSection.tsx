import * as React from "react";
import {
  Activity,
  ChevronRight,
  CircleAlert,
  Clock3,
  Plus,
  RotateCw,
} from "lucide-react";

import {
  filterAndSortFleetAgents,
  type FleetAgent,
  type FleetFilter,
  type FleetSort,
} from "@/features/agents/lib/agentFleet";
import { useOpenAgentActivity } from "@/features/agents/useOpenAgentActivity";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useNow } from "@/shared/lib/useNow";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Skeleton } from "@/shared/ui/skeleton";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { formatElapsed } from "@/features/agents/ui/agentSessionUtils";

const FILTERS: Array<{ value: FleetFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "working", label: "Working" },
  { value: "needs-attention", label: "Needs attention" },
  { value: "stopped", label: "Stopped" },
];

const STATUS_PRESENTATION = {
  working: {
    className: "text-emerald-800 dark:text-emerald-300",
    label: "Working",
    variant: "success" as const,
  },
  "needs-attention": {
    className: "text-amber-900 dark:text-amber-300",
    label: "Needs attention",
    variant: "warning" as const,
  },
  starting: {
    className: "text-blue-800 dark:text-blue-300",
    label: "Starting",
    variant: "info" as const,
  },
  stopped: {
    className: undefined,
    label: "Stopped",
    variant: "secondary" as const,
  },
  idle: {
    className: undefined,
    label: "Idle",
    variant: "outline" as const,
  },
};

function relativeActivityLabel(timestamp: number | null, now: number): string {
  if (timestamp === null) return "No activity yet";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function FleetLoadingState() {
  return (
    <div aria-label="Loading your agents" className="space-y-2" role="status">
      {[0, 1].map((row) => (
        <div
          className="flex min-h-24 items-center gap-3 rounded-2xl bg-muted/25 px-4 py-3"
          key={row}
        >
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      ))}
      <span className="sr-only">Loading your agents…</span>
    </div>
  );
}

function FleetEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl bg-muted/25 px-5 py-7 text-center sm:px-8">
      <p className="text-base font-medium">No agents yet</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
        Create an agent to monitor its live work, recent activity, and locally
        reported usage here.
      </p>
      <Button className="mt-4 min-h-11" onClick={onCreate} type="button">
        <Plus />
        New agent
      </Button>
    </div>
  );
}

function FleetAgentRow({
  agent,
  canOpenAgentActivity,
  now,
  onOpenAgentActivity,
  onOpenProfile,
}: {
  agent: FleetAgent;
  canOpenAgentActivity: (pubkey: string) => boolean;
  now: number;
  onOpenAgentActivity: (pubkey: string) => boolean;
  onOpenProfile: (pubkey: string) => void;
}) {
  const status = STATUS_PRESENTATION[agent.status];
  const activityIsOpenable = canOpenAgentActivity(agent.pubkey);
  const activityUnavailableDescriptionId = `agent-fleet-activity-unavailable-${agent.pubkey}`;
  const activity = agent.currentAction
    ? agent.currentAction
    : agent.status === "needs-attention"
      ? "Review agent status"
      : "No current action";
  const duration =
    agent.durationAnchorAt === null
      ? null
      : formatElapsed(now - agent.durationAnchorAt);

  return (
    <li
      className="grid gap-4 rounded-2xl bg-muted/25 px-4 py-4 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(12rem,1fr)_minmax(13rem,1fr)_auto] lg:items-center"
      data-testid={`agent-fleet-row-${agent.pubkey}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar
          avatarUrl={agent.avatarUrl}
          displayName={agent.name}
          size="md"
          testId={`agent-fleet-avatar-${agent.pubkey}`}
        />
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{agent.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge className={status.className} variant={status.variant}>
              {status.label}
            </Badge>
            <span className="text-2xs text-muted-foreground">
              {agent.source === "managed" ? "Managed by you" : "Owned by you"}
            </span>
          </div>
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <p className="truncate font-medium" title={activity}>
          {activity}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <span>
            {agent.lastActivityAt === null
              ? "No activity yet"
              : `Last active ${relativeActivityLabel(agent.lastActivityAt, now)}`}
          </span>
          {duration ? <span>Working for {duration}</span> : null}
        </p>
      </div>

      <div className="min-w-0 space-y-1 text-2xs text-muted-foreground">
        <p className="truncate" title={agent.usage.modelLabel}>
          {agent.usage.modelLabel}
        </p>
        <p className="truncate" title={agent.usage.tokenLabel}>
          {agent.usage.tokenLabel}
        </p>
        <p className="truncate" title={agent.usage.costLabel}>
          {agent.usage.costLabel}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 lg:justify-end">
        <Button
          aria-describedby={
            activityIsOpenable ? undefined : activityUnavailableDescriptionId
          }
          aria-label={
            activityIsOpenable
              ? `View ${agent.name}'s activity`
              : `View ${agent.name}'s activity unavailable`
          }
          className="min-h-11"
          disabled={!activityIsOpenable}
          onClick={() => onOpenAgentActivity(agent.pubkey)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Activity />
          Activity
        </Button>
        {!activityIsOpenable ? (
          <span className="sr-only" id={activityUnavailableDescriptionId}>
            Activity is available only in channels you can open.
          </span>
        ) : null}
        <Button
          aria-label={`Manage ${agent.name}`}
          className="min-h-11"
          onClick={() => onOpenProfile(agent.pubkey)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Manage
          <ChevronRight />
        </Button>
      </div>
    </li>
  );
}

export function AgentFleetSection({
  agents,
  collectionEnabled,
  isLoading,
  isUsageLoading,
  onCreate,
  onOpenProfile,
  onRetryUsage,
  usageError,
}: {
  agents: readonly FleetAgent[];
  collectionEnabled: boolean | null;
  isLoading: boolean;
  isUsageLoading: boolean;
  onCreate: () => void;
  onOpenProfile: (pubkey: string) => void;
  onRetryUsage: () => void;
  usageError: Error | null;
}) {
  const [filter, setFilter] = React.useState<FleetFilter>("all");
  const [sort, setSort] = React.useState<FleetSort>("activity");
  const now = useNow(10_000);
  const { goSettings } = useAppNavigation();
  const { canOpenAgentActivity, openAgentActivity } = useOpenAgentActivity();
  const visibleAgents = React.useMemo(
    () => filterAndSortFleetAgents(agents, filter, sort),
    [agents, filter, sort],
  );
  const workingCount = agents.filter(
    (agent) => agent.status === "working",
  ).length;
  const attentionCount = agents.filter(
    (agent) => agent.status === "needs-attention",
  ).length;
  const liveFleetSummary = agents
    .filter(
      (agent) =>
        agent.status === "working" || agent.status === "needs-attention",
    )
    .map(
      (agent) =>
        `${agent.name}: ${STATUS_PRESENTATION[agent.status].label}${agent.currentAction ? `, ${agent.currentAction}` : ""}`,
    )
    .join(". ");

  return (
    <section aria-labelledby="my-agents-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" id="my-agents-heading">
            My agents
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Owner-only activity and locally reported usage from the last 7 days.
          </p>
        </div>
        <Button className="min-h-11" onClick={onCreate} type="button">
          <Plus />
          New agent
        </Button>
      </div>

      {isLoading && agents.length === 0 ? <FleetLoadingState /> : null}

      {!isLoading && agents.length === 0 ? (
        <FleetEmptyState onCreate={onCreate} />
      ) : null}

      {agents.length > 0 ? (
        <>
          <p aria-atomic="true" aria-live="polite" className="sr-only">
            {liveFleetSummary || "No agents are working or need attention."}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            <span>{agents.length} agents</span>
            <span aria-hidden="true">·</span>
            <span>{workingCount} working</span>
            {attentionCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {attentionCount}{" "}
                  {attentionCount === 1 ? "needs attention" : "need attention"}
                </span>
              </>
            ) : null}
            {isUsageLoading ? (
              <span className="ml-auto">Loading reported usage…</span>
            ) : null}
          </div>

          {usageError ? (
            <Alert variant="destructive">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <AlertTitle>Usage is unavailable</AlertTitle>
                  <AlertDescription>
                    Activity remains available. Try loading the local usage
                    archive again.
                  </AlertDescription>
                </div>
                <Button
                  className="min-h-11"
                  onClick={onRetryUsage}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCw />
                  Retry
                </Button>
              </div>
            </Alert>
          ) : null}

          {collectionEnabled === false ? (
            <Alert>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <AlertTitle>Usage archiving is off</AlertTitle>
                  <AlertDescription>
                    Turn metrics are not being archived on this device. Turn on
                    metric archiving to retain reported usage here.
                  </AlertDescription>
                </div>
                <Button
                  className="min-h-11"
                  onClick={() => void goSettings("local-archive")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Archive settings
                </Button>
              </div>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 rounded-2xl bg-muted/15 p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <fieldset className="min-w-0">
              <legend className="sr-only">Filter agents</legend>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((option) => (
                  <button
                    aria-pressed={filter === option.value}
                    className="min-h-11 min-w-11 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex min-h-11 items-center gap-2 self-start px-2 text-sm text-muted-foreground sm:self-auto">
              <span>Sort</span>
              <select
                aria-label="Sort agents"
                className="min-h-11 bg-transparent font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setSort(event.target.value as FleetSort)}
                value={sort}
              >
                <option value="activity">Activity</option>
                <option value="name">Name</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>

          {visibleAgents.length === 0 ? (
            <div className="rounded-2xl bg-muted/25 px-5 py-7 text-center text-sm text-muted-foreground">
              No agents match this filter.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="agent-fleet-list">
              {visibleAgents.map((agent) => (
                <FleetAgentRow
                  agent={agent}
                  canOpenAgentActivity={canOpenAgentActivity}
                  key={agent.pubkey}
                  now={now}
                  onOpenAgentActivity={openAgentActivity}
                  onOpenProfile={onOpenProfile}
                />
              ))}
            </ul>
          )}
          <p className="flex items-start gap-2 text-2xs leading-5 text-muted-foreground">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Usage is reported by the agent and may be unavailable or partial.
            This view covers the last 7 days; costs are estimates, not billing
            records.
          </p>
          <p className="flex items-start gap-2 text-2xs leading-5 text-muted-foreground">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Activity opens only in channels you can access; this overview never
            names those channels.
          </p>
        </>
      ) : null}
    </section>
  );
}

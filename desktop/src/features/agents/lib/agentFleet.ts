import type {
  AgentUsage,
  AgentUsageModel,
  ReportedUsage,
  UsageField,
} from "@/shared/api/tauriArchive";
import type { ActiveTurnDetail } from "@/features/agents/activeAgentTurnsStore";
import type {
  ObserverEvent,
  TranscriptItem,
} from "@/features/agents/ui/agentSessionTypes";

export type FleetAgentSource = "managed" | "owner";

/** The deliberately small, owner-safe agent shape consumed by the fleet. */
export type FleetAgentCandidate = {
  pubkey: string;
  name: string;
  avatarUrl: string | null;
  configuredModel: string | null;
  source: FleetAgentSource;
  runtime: "starting" | "stopped" | "idle";
  hasRuntimeError: boolean;
  attentionReason: string | null;
};

export type FleetAgentStatus =
  | "working"
  | "needs-attention"
  | "starting"
  | "stopped"
  | "idle";

export type FleetUsageSummary = {
  tokenLabel: string;
  costLabel: string;
  modelLabel: string;
  hasUsage: boolean;
};

export type FleetAgent = FleetAgentCandidate & {
  status: FleetAgentStatus;
  currentAction: string | null;
  lastActivityAt: number | null;
  durationAnchorAt: number | null;
  usage: FleetUsageSummary;
};

export type FleetFilter = "all" | "working" | "needs-attention" | "stopped";
export type FleetSort = "activity" | "name" | "status";

const STATUS_ORDER: Record<FleetAgentStatus, number> = {
  "needs-attention": 0,
  working: 1,
  starting: 2,
  idle: 3,
  stopped: 4,
};

const EMPTY_USAGE: FleetUsageSummary = {
  tokenLabel: "Tokens unavailable",
  costLabel: "Cost unavailable",
  modelLabel: "Model unavailable",
  hasUsage: false,
};

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function newestObserverTimestamp(
  events: readonly ObserverEvent[],
): number | null {
  let newest: number | null = null;
  for (const event of events) {
    const timestamp = timestampMs(event.timestamp);
    if (timestamp !== null && (newest === null || timestamp > newest)) {
      newest = timestamp;
    }
  }
  return newest;
}

function hasUnresolvedObserverFailure(
  events: readonly ObserverEvent[],
): boolean {
  let latestFailure: number | null = null;
  let latestRecovery: number | null = null;
  for (const event of events) {
    const timestamp = timestampMs(event.timestamp);
    if (timestamp === null) continue;
    if (event.kind === "turn_error" || event.kind === "agent_panic") {
      latestFailure = Math.max(latestFailure ?? timestamp, timestamp);
      continue;
    }
    if (
      event.kind === "turn_started" ||
      event.kind === "turn_completed" ||
      event.kind === "turn_liveness" ||
      event.kind === "acp_read" ||
      event.kind === "acp_write"
    ) {
      latestRecovery = Math.max(latestRecovery ?? timestamp, timestamp);
    }
  }
  return (
    latestFailure !== null &&
    (latestRecovery === null || latestFailure > latestRecovery)
  );
}

/**
 * Pick a safe, intentionally terse activity label. Transcript message text,
 * tool arguments/results, plans, and observer payloads never cross this
 * boundary.
 */
export function currentFleetAction(
  transcript: readonly TranscriptItem[],
  activeTurns: readonly ActiveTurnDetail[],
): string | null {
  const activeTurnIds = new Set(activeTurns.map((turn) => turn.turnId));
  if (activeTurnIds.size === 0) return null;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (!item?.turnId || !activeTurnIds.has(item.turnId)) continue;
    if (item.type === "tool" && item.descriptor.label.trim()) {
      return item.descriptor.label.trim();
    }
    if (item.type === "lifecycle" && item.descriptor?.label.trim()) {
      return item.descriptor.label.trim();
    }
  }

  return "Activity details unavailable";
}

function compactTokenCount(value: string): string | null {
  try {
    const tokens = BigInt(value);
    if (tokens < 0n) return null;
    if (tokens < 1_000n) return tokens.toString();
    if (tokens < 1_000_000n) {
      const tenths = (tokens % 1_000n) / 100n;
      return `${tokens / 1_000n}${tenths > 0n ? `.${tenths}` : ""}k`;
    }
    const tenths = (tokens % 1_000_000n) / 100_000n;
    return `${tokens / 1_000_000n}${tenths > 0n ? `.${tenths}` : ""}m`;
  } catch {
    return null;
  }
}

function tokenLabel(field: UsageField): string {
  if (field.value === null) return "Tokens unavailable";
  const formatted = compactTokenCount(field.value);
  if (!formatted) return "Tokens unavailable";
  return `Tokens: ${formatted} reported${field.incomplete ? " (partial)" : ""}`;
}

function costLabel(usage: ReportedUsage): string {
  const field = usage.estimatedCostUsd;
  if (
    field.value === null ||
    !Number.isFinite(field.value) ||
    field.value < 0
  ) {
    return "Cost unavailable";
  }
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: field.value < 0.1 ? 4 : 2,
  }).format(field.value);
  return `Cost: ~${amount} reported estimate${field.incomplete ? " (partial)" : ""}`;
}

function modelLabel(
  models: readonly AgentUsageModel[],
  configuredModel: string | null,
): string {
  const reportedModels = models
    .filter((model) => model.model?.trim())
    .sort(
      (left, right) =>
        right.reportCount - left.reportCount ||
        (left.model ?? "").localeCompare(right.model ?? ""),
    );
  const model = reportedModels[0]?.model?.trim();
  if (!model) {
    return configuredModel?.trim()
      ? `Model: ${configuredModel.trim()} (configured)`
      : "Model unavailable";
  }
  if (new Set(reportedModels.map((entry) => entry.model)).size > 1) {
    return `Model: ${model} +${new Set(reportedModels.map((entry) => entry.model)).size - 1} reported`;
  }
  return `Model: ${model} (reported)`;
}

export function fleetUsageSummary(
  usage: AgentUsage | undefined,
  configuredModel: string | null = null,
): FleetUsageSummary {
  if (!usage || usage.reportCount === 0) {
    return configuredModel?.trim()
      ? {
          ...EMPTY_USAGE,
          modelLabel: `Model: ${configuredModel.trim()} (configured)`,
        }
      : EMPTY_USAGE;
  }
  return {
    tokenLabel: tokenLabel(usage.usage.totalTokens),
    costLabel: costLabel(usage.usage),
    modelLabel: modelLabel(usage.models, configuredModel),
    hasUsage: true,
  };
}

export function buildFleetAgent({
  activeTurns,
  candidate,
  events,
  transcript,
  usage,
}: {
  candidate: FleetAgentCandidate;
  activeTurns: readonly ActiveTurnDetail[];
  events: readonly ObserverEvent[];
  transcript: readonly TranscriptItem[];
  usage: AgentUsage | undefined;
}): FleetAgent {
  const isWorking = activeTurns.length > 0;
  const hasAttention =
    candidate.hasRuntimeError || hasUnresolvedObserverFailure(events);
  const status: FleetAgentStatus = hasAttention
    ? "needs-attention"
    : isWorking
      ? "working"
      : candidate.runtime;
  const observerActivity = newestObserverTimestamp(events);
  const activeActivity = activeTurns.reduce<number | null>(
    (latest, turn) =>
      Math.max(latest ?? turn.lastActivityAt, turn.lastActivityAt),
    null,
  );

  return {
    ...candidate,
    status,
    currentAction: isWorking
      ? currentFleetAction(transcript, activeTurns)
      : hasAttention
        ? (candidate.attentionReason ?? "Agent run failed")
        : null,
    lastActivityAt:
      Math.max(observerActivity ?? 0, activeActivity ?? 0) || null,
    durationAnchorAt: isWorking
      ? Math.min(...activeTurns.map((turn) => turn.anchorAt))
      : null,
    usage: fleetUsageSummary(usage, candidate.configuredModel),
  };
}

/**
 * Reduce runtime failures to a short owner-safe category. Raw harness output
 * can contain prompts, paths, or credentials, so it must never reach the fleet.
 */
export function safeRuntimeAttentionReason(
  raw: string | null,
  code: number | null,
): string | null {
  if (!raw?.trim()) return null;
  if (
    code === -32001 ||
    /authentication required|\bllm auth\b|access denied/i.test(raw)
  ) {
    return "Authentication required";
  }
  if (code === -32002 || /model (?:is )?not (?:available|found)/i.test(raw)) {
    return "Model unavailable";
  }
  return "Agent run failed";
}

export function filterAndSortFleetAgents(
  agents: readonly FleetAgent[],
  filter: FleetFilter,
  sort: FleetSort,
): FleetAgent[] {
  const filtered = agents.filter((agent) => {
    if (filter === "all") return true;
    if (filter === "stopped") return agent.status === "stopped";
    return agent.status === filter;
  });

  return [...filtered].sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name);
    if (sort === "status") {
      return (
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        left.name.localeCompare(right.name)
      );
    }
    return (
      (right.lastActivityAt ?? -Infinity) -
        (left.lastActivityAt ?? -Infinity) ||
      left.name.localeCompare(right.name)
    );
  });
}

export function localMidnightBoundaries(
  days: number,
  now = new Date(),
): number[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const end = new Date(today);
  end.setDate(end.getDate() + 1);

  const boundaries = [end];
  let cursor = today;
  for (let offset = 0; offset < days; offset += 1) {
    boundaries.push(cursor);
    const previous = new Date(cursor);
    previous.setDate(previous.getDate() - 1);
    cursor = previous;
  }
  return boundaries
    .reverse()
    .map((boundary) => Math.floor(boundary.getTime() / 1_000));
}

/** Milliseconds until the next local midnight; recalculated after every fire. */
export function msUntilNextLocalMidnight(now = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

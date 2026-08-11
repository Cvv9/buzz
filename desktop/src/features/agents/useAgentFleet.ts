import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getActiveTurnDetailsForAgent,
  subscribeActiveAgentTurns,
} from "@/features/agents/activeAgentTurnsStore";
import {
  getAgentObserverSnapshot,
  getAgentTranscript,
  subscribeAgentObserverStore,
} from "@/features/agents/observerRelayStore";
import {
  buildFleetAgent,
  localMidnightBoundaries,
  msUntilNextLocalMidnight,
  safeRuntimeAttentionReason,
  type FleetAgent,
  type FleetAgentCandidate,
} from "@/features/agents/lib/agentFleet";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  getAgentUsageSeries,
  onAgentMetricsChanged,
} from "@/shared/api/tauriArchive";
import type { ManagedAgent, RelayAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

const USAGE_DAYS = 7;

function useStoreVersion(subscribe: (listener: () => void) => () => void) {
  const [version, setVersion] = React.useState(0);
  React.useEffect(
    () => subscribe(() => setVersion((version) => version + 1)),
    [subscribe],
  );
  return version;
}

function relayOwnerMatches(
  agent: RelayAgent,
  identityPubkey: string | undefined,
) {
  return Boolean(
    identityPubkey &&
      agent.ownerPubkey &&
      normalizePubkey(agent.ownerPubkey) === normalizePubkey(identityPubkey),
  );
}

function buildFleetCandidates({
  identityPubkey,
  managedAgents,
  relayAgents,
  startingAgentPubkey,
}: {
  identityPubkey: string | undefined;
  managedAgents: readonly ManagedAgent[];
  relayAgents: readonly RelayAgent[];
  startingAgentPubkey: string | null;
}): FleetAgentCandidate[] {
  const candidates = new Map<string, FleetAgentCandidate>();
  for (const agent of managedAgents) {
    const pubkey = normalizePubkey(agent.pubkey);
    candidates.set(pubkey, {
      pubkey: agent.pubkey,
      name: agent.name,
      avatarUrl: agent.avatarUrl,
      configuredModel: agent.model,
      source: "managed",
      runtime:
        normalizePubkey(startingAgentPubkey ?? "") === pubkey
          ? "starting"
          : agent.status === "running" || agent.status === "deployed"
            ? "idle"
            : "stopped",
      hasRuntimeError: Boolean(agent.lastError),
      attentionReason: safeRuntimeAttentionReason(
        agent.lastError,
        agent.lastErrorCode,
      ),
    });
  }

  for (const agent of relayAgents) {
    if (!relayOwnerMatches(agent, identityPubkey)) continue;
    const pubkey = normalizePubkey(agent.pubkey);
    if (candidates.has(pubkey)) continue;
    candidates.set(pubkey, {
      pubkey: agent.pubkey,
      name: agent.name,
      avatarUrl: agent.avatarUrl ?? null,
      configuredModel: agent.model ?? null,
      source: "owner",
      runtime: agent.status === "offline" ? "stopped" : "idle",
      hasRuntimeError: false,
      attentionReason: null,
    });
  }

  return [...candidates.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function useAgentFleet({
  managedAgents,
  relayAgents,
  startingAgentPubkey,
}: {
  managedAgents: readonly ManagedAgent[];
  relayAgents: readonly RelayAgent[];
  startingAgentPubkey: string | null;
}) {
  const identityQuery = useIdentityQuery();
  const identityPubkey = identityQuery.data?.pubkey;
  const candidates = React.useMemo(
    () =>
      buildFleetCandidates({
        identityPubkey,
        managedAgents,
        relayAgents,
        startingAgentPubkey,
      }),
    [identityPubkey, managedAgents, relayAgents, startingAgentPubkey],
  );

  // These production stores are deliberately external to React so activity
  // remains available to profile panels and the fleet without duplicating raw
  // observer state. The version ticks participate in the fleet projection so
  // each store notification also refreshes its agent-scoped stable snapshot.
  const observerVersion = useStoreVersion(subscribeAgentObserverStore);
  const activeTurnsVersion = useStoreVersion(subscribeActiveAgentTurns);

  const [localDayRevision, setLocalDayRevision] = React.useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision reschedules this one-shot timer at each local midnight
  React.useEffect(() => {
    const timeout = window.setTimeout(
      () => setLocalDayRevision((revision) => revision + 1),
      msUntilNextLocalMidnight(),
    );
    return () => window.clearTimeout(timeout);
  }, [localDayRevision]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision intentionally rebuilds boundaries after local-midnight rollover
  const bucketBoundaries = React.useMemo(
    () => localMidnightBoundaries(USAGE_DAYS),
    [localDayRevision],
  );
  const queryClient = useQueryClient();
  const usageQueryKey = React.useMemo(
    () => ["agent-usage-series", ...bucketBoundaries] as const,
    [bucketBoundaries],
  );
  const usageQuery = useQuery({
    enabled: candidates.length > 0,
    queryKey: usageQueryKey,
    queryFn: () => getAgentUsageSeries({ bucketBoundaries }),
    staleTime: 30_000,
  });

  React.useEffect(
    () =>
      onAgentMetricsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: usageQueryKey });
      }),
    [queryClient, usageQueryKey],
  );

  const agents = React.useMemo(() => {
    // These revisions are the invalidation boundary for external stores. Read
    // them inside the projection so React recomputes rows when a live frame
    // changes the safe observer snapshot or active-turn state.
    void observerVersion;
    void activeTurnsVersion;
    const usageByPubkey = new Map(
      (usageQuery.data?.agents ?? []).map((usage) => [
        normalizePubkey(usage.agentPubkey),
        usage,
      ]),
    );
    return candidates.map((candidate) => {
      const snapshot = getAgentObserverSnapshot(candidate.pubkey, true);
      return buildFleetAgent({
        candidate,
        activeTurns: getActiveTurnDetailsForAgent(candidate.pubkey),
        events: snapshot.events,
        transcript: getAgentTranscript(candidate.pubkey, true),
        usage: usageByPubkey.get(normalizePubkey(candidate.pubkey)),
      });
    });
  }, [activeTurnsVersion, candidates, observerVersion, usageQuery.data]);

  return {
    agents: agents satisfies FleetAgent[],
    isLoading:
      identityQuery.isLoading ||
      (candidates.length > 0 && usageQuery.isLoading),
    isUsageLoading: candidates.length > 0 && usageQuery.isLoading,
    usageError: usageQuery.error instanceof Error ? usageQuery.error : null,
    collectionEnabled: usageQuery.data?.collectionEnabled ?? null,
    refetchUsage: () => void usageQuery.refetch(),
  };
}

import * as React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAgentScheduledWorkflows,
  prepareManualWorkflowRequest,
  submitManualWorkflowRequest,
  type PreparedManualWorkflowRequest,
} from "@/features/workflows/workflow-api";
import {
  canRunScheduledWorkflow,
  type AgentScheduledWorkflow,
  type ManualWorkflowDecision,
} from "@/features/workflows/workflow-policy";
import { getUnlockedBrowserIdentity } from "@/shared/lib/browser-identity";
import { subscribeEvents } from "@/shared/lib/nostr-client";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

type RequestState = {
  pending?: boolean;
  error?: string;
  decision?: ManualWorkflowDecision;
  retrySame?: boolean;
};

/** Owner settings state, scoped to one relay, viewer and immutable agent key. */
export function useAgentScheduledWorkflows(
  agentPubkey: string,
  viewerPubkey: string,
  canManage: boolean,
) {
  const queryClient = useQueryClient();
  const relayBase = relayHttpBaseUrl();
  const scope = React.useMemo(
    () => ({ relayBase, viewerPubkey }),
    [relayBase, viewerPubkey],
  );
  const queryKey = React.useMemo(
    () => ["agent-scheduled-workflows", relayBase, viewerPubkey, agentPubkey],
    [relayBase, viewerPubkey, agentPubkey],
  );
  const [visible, setVisible] = React.useState(
    () => document.visibilityState === "visible",
  );
  const [online, setOnline] = React.useState(() => navigator.onLine);
  const [identityValid, setIdentityValid] = React.useState(true);
  const [live, setLive] = React.useState(false);
  const [now, setNow] = React.useState(Date.now);
  const [requests, setRequests] = React.useState<Record<string, RequestState>>(
    {},
  );
  const prepared = React.useRef(
    new Map<string, PreparedManualWorkflowRequest>(),
  );
  const inflight = React.useRef(new Map<string, Promise<void>>());
  const lifetime = React.useRef(new AbortController());
  const enabled = canManage && identityValid && online;
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      listAgentScheduledWorkflows(scope, agentPubkey, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next ?? undefined,
    enabled,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: visible && enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  const refresh = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  React.useEffect(() => {
    lifetime.current = new AbortController();
    setIdentityValid(getUnlockedBrowserIdentity()?.pubkey === viewerPubkey);
    setRequests({});
    const identityChanged = () => {
      if (getUnlockedBrowserIdentity()?.pubkey === viewerPubkey) return;
      lifetime.current.abort();
      prepared.current.clear();
      inflight.current.clear();
      setIdentityValid(false);
      setRequests({});
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    };
    window.addEventListener("buzz-browser-identity-changed", identityChanged);
    return () => {
      lifetime.current.abort();
      prepared.current.clear();
      inflight.current.clear();
      window.removeEventListener(
        "buzz-browser-identity-changed",
        identityChanged,
      );
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    };
  }, [viewerPubkey, queryClient, queryKey]);

  React.useEffect(() => {
    const updateVisibility = () => {
      const next = document.visibilityState === "visible";
      setVisible(next);
      if (next && navigator.onLine && canManage && identityValid)
        void refresh();
    };
    const updateOnline = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) setLive(false);
      // Only reads refresh; pending commands never resume on reconnect.
      if (navigator.onLine && canManage && identityValid) void refresh();
    };
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("focus", updateVisibility);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("focus", updateVisibility);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.clearInterval(timer);
    };
  }, [canManage, identityValid, refresh]);

  React.useEffect(() => {
    setLive(false);
    if (!enabled) return;
    return subscribeEvents(
      relayWsUrl(),
      { kinds: [46042], "#p": [viewerPubkey] },
      (event) => {
        // This is an invalidation only. No event content becomes execution state.
        if (
          event.kind === 46042 &&
          event.tags.some((tag) => tag[0] === "p" && tag[1] === viewerPubkey)
        )
          void refresh();
      },
      (status) => {
        setLive(status === "live");
        if (status === "live") void refresh();
      },
    );
  }, [enabled, viewerPubkey, refresh]);

  const rows = React.useMemo(() => {
    const byId = new Map<string, AgentScheduledWorkflow>();
    for (const page of query.data?.pages ?? [])
      for (const row of page.workflows) byId.set(row.workflow_id, row);
    return [...byId.values()];
  }, [query.data]);
  const stale = now - query.dataUpdatedAt > 30_000;
  const ready =
    enabled && live && !query.isError && !query.isFetching && !stale;
  const serverClock = query.data?.pages[0]?.server_now;
  const serverNow = serverClock
    ? Date.parse(serverClock) + Math.max(0, now - query.dataUpdatedAt)
    : now;

  const run = (row: AgentScheduledWorkflow): Promise<void> => {
    const existing = inflight.current.get(row.workflow_id);
    if (existing) return existing;
    if (
      !ready ||
      !navigator.onLine ||
      getUnlockedBrowserIdentity()?.pubkey !== viewerPubkey
    )
      return Promise.resolve();
    const saved = prepared.current.get(row.workflow_id);
    if (!saved && !canRunScheduledWorkflow(row)) return Promise.resolve();
    const signal = lifetime.current.signal;
    setRequests((current) => ({
      ...current,
      [row.workflow_id]: { pending: true },
    }));
    const promise = (async () => {
      try {
        const request =
          saved ??
          (await prepareManualWorkflowRequest(
            scope,
            row.workflow_id,
            row.definition_hash,
            signal,
          ));
        signal.throwIfAborted();
        prepared.current.set(row.workflow_id, request);
        const decision = await submitManualWorkflowRequest(request, signal);
        signal.throwIfAborted();
        prepared.current.delete(row.workflow_id);
        setRequests((current) => ({
          ...current,
          [row.workflow_id]: { decision },
        }));
      } catch (error) {
        if (signal.aborted) return;
        setRequests((current) => ({
          ...current,
          [row.workflow_id]: {
            error:
              error instanceof Error
                ? error.message
                : "Could not confirm this workflow request.",
            retrySame: prepared.current.has(row.workflow_id),
          },
        }));
      } finally {
        inflight.current.delete(row.workflow_id);
        if (!signal.aborted && navigator.onLine) await refresh();
      }
    })();
    inflight.current.set(row.workflow_id, promise);
    return promise;
  };
  return {
    query,
    rows,
    requests,
    online,
    live,
    ready,
    serverNow,
    run,
    refresh,
  };
}

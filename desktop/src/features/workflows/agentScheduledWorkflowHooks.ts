import * as React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { useRelayConnection } from "@/shared/api/useRelayConnection";
import {
  getAgentScheduledWorkflows,
  prepareManualWorkflow,
  submitManualWorkflow,
} from "@/shared/api/tauriWorkflows";
import type {
  AgentScheduledWorkflow,
  ManualWorkflowReceipt,
  PreparedManualWorkflow,
} from "@/shared/api/workflowTypes";
import { KIND_WORKFLOW_RUN_STATUS } from "@/shared/constants/kinds";
import {
  useAppFocused,
  useDocumentVisible,
} from "@/shared/lib/useDocumentVisible";
import {
  manualWorkflowBlocked,
  scheduledWorkflowQueryKey,
} from "./manualRunPolicy";

type RequestState = {
  envelope?: PreparedManualWorkflow;
  pending: boolean;
  uncertain: boolean;
  message?: string;
  receipt?: ManualWorkflowReceipt;
};

/** Panel-local request state survives closing the dialog, but never crosses identity or community. */
export function useAgentScheduledWorkflows(
  agentPubkey: string,
  ownerPubkey: string | undefined,
  isOwner: boolean,
  open: boolean,
) {
  const { activeCommunity, reinitKey } = useCommunities();
  const queryClient = useQueryClient();
  const visible = useDocumentVisible();
  const focused = useAppFocused();
  const connection = useRelayConnection({ degradedAfterMs: 0 });
  const community = `${activeCommunity?.id ?? "none"}:${reinitKey}`;
  const relay = activeCommunity?.relayUrl ?? "";
  const owner = ownerPubkey?.toLowerCase() ?? "";
  const scope = React.useMemo(
    () => ({ relayUrl: relay, ownerPubkey: owner }),
    [relay, owner],
  );
  const key = React.useMemo(
    () => scheduledWorkflowQueryKey(community, relay, owner, agentPubkey),
    [community, relay, owner, agentPubkey],
  );
  const scopeId = JSON.stringify(key);
  const enabled = open && isOwner && Boolean(relay && owner);
  const current = React.useRef({ scopeId, enabled, generation: 0 });
  // A new scope renders an empty request store immediately; only committed renders
  // update the asynchronous guards used by preparation and submission.
  const requestStore = React.useMemo(
    () => ({ scopeId, rows: new Map<string, RequestState>() }),
    [scopeId],
  );
  const requests = React.useRef(requestStore);
  React.useLayoutEffect(() => {
    current.current.scopeId = scopeId;
    current.current.enabled = enabled;
    requests.current = requestStore;
    return () => {
      current.current.enabled = false;
      current.current.generation += 1;
    };
  }, [scopeId, enabled, requestStore]);
  const [, repaint] = React.useReducer((value) => value + 1, 0);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled: enabled && connection === "connected",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      if (signal.aborted) throw new Error("Workflow query cancelled.");
      const page = await getAgentScheduledWorkflows(
        scope,
        agentPubkey,
        pageParam,
      );
      if (signal.aborted || current.current.scopeId !== scopeId)
        throw new Error("Workflow scope changed.");
      return page;
    },
    getNextPageParam: (last) => last.next,
    refetchInterval:
      enabled && visible && connection === "connected" ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
    networkMode: "always",
  });
  const refresh = React.useCallback(() => {
    if (
      current.current.scopeId === scopeId &&
      current.current.enabled &&
      relayClient.getConnectionState() === "connected"
    ) {
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    }
  }, [scopeId, queryClient, key]);
  React.useEffect(() => {
    if (enabled && focused) refresh();
  }, [enabled, focused, refresh]);
  React.useEffect(() => relayClient.subscribeToReconnects(refresh), [refresh]);
  React.useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.removeQueries({ queryKey: key, exact: true });
    };
  }, [key, queryClient]);
  const rows = query.data?.pages.flatMap((page) => page.workflows) ?? [];
  const channels = [...new Set(rows.map((row) => row.channelId))]
    .sort()
    .join(",");
  React.useEffect(() => {
    if (!enabled || !channels || connection !== "connected") return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void relayClient
      .subscribeLive(
        {
          kinds: [KIND_WORKFLOW_RUN_STATUS],
          limit: 1,
          "#p": [owner],
          "#h": channels.split(","),
        },
        () => {
          if (!cancelled) refresh();
        },
      )
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => {
        /* Focus, reconnect and polling repair a missed subscription. */
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [enabled, connection, channels, owner, refresh]);
  const run = React.useCallback(
    async (row: AgentScheduledWorkflow) => {
      if (current.current.scopeId !== scopeId || !current.current.enabled)
        return;
      const generation = current.current.generation;
      const store = requests.current.rows;
      const previous = store.get(row.workflowId);
      if (previous?.pending) return; // Synchronous guard, before preparation or React state updates.
      if (
        relayClient.getConnectionState() !== "connected" ||
        !navigator.onLine
      ) {
        store.set(row.workflowId, {
          ...previous,
          pending: false,
          uncertain: previous?.uncertain ?? false,
          message: "Reconnect before running. Nothing has been queued.",
        });
        repaint();
        return;
      }
      if (!previous?.uncertain && manualWorkflowBlocked(row)) return;
      const request: RequestState = {
        envelope: previous?.uncertain ? previous.envelope : undefined,
        pending: true,
        uncertain: false,
      };
      store.set(row.workflowId, request);
      repaint();
      const stillCurrent = () =>
        current.current.scopeId === scopeId && requests.current.rows === store;
      try {
        request.envelope ??= await prepareManualWorkflow(
          scope,
          row.workflowId,
          row.definitionHash,
        );
        if (
          !stillCurrent() ||
          !current.current.enabled ||
          current.current.generation !== generation ||
          relayClient.getConnectionState() !== "connected" ||
          !navigator.onLine
        ) {
          request.pending = false;
          request.message =
            "Request not sent. Reopen while connected to try again.";
          return;
        }
        request.uncertain = true; // Set BEFORE dispatch; an exception may mean lost receipt.
        request.receipt = await submitManualWorkflow(request.envelope);
        request.uncertain = false;
        request.message = request.receipt.accepted
          ? "Run accepted. Refreshing actual status…"
          : undefined;
      } catch {
        request.message = request.uncertain
          ? "Outcome unconfirmed. Check status or retry this same request."
          : "Could not prepare this workflow. Refresh and try again.";
      } finally {
        request.pending = false;
        if (stillCurrent()) {
          repaint();
          refresh();
        }
      }
    },
    [scope, scopeId, refresh],
  );
  return {
    query,
    rows,
    connection,
    refresh,
    run,
    requests: requestStore.rows,
  };
}

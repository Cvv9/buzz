import { useQuery } from "@tanstack/react-query";
import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { SEARCHABLE_EVENT_KINDS, type SearchFilters } from "./search-policy";

export const SEARCH_RESULT_LIMIT = 50;

export async function searchWorkspace(
  filters: SearchFilters,
): Promise<NostrEvent[]> {
  return queryEvents(relayWsUrl(), {
    // Relay search requests must always be explicit-kind. This list covers
    // the browser's current message, forum, repository, and project surfaces.
    kinds: [...SEARCHABLE_EVENT_KINDS],
    search: filters.query,
    ...(filters.channelId ? { "#h": [filters.channelId] } : {}),
    ...(filters.author ? { authors: [filters.author] } : {}),
    ...(filters.since !== undefined ? { since: filters.since } : {}),
    ...(filters.until !== undefined ? { until: filters.until } : {}),
    limit: SEARCH_RESULT_LIMIT,
  });
}

export function useWorkspaceSearch(filters: SearchFilters | null) {
  return useQuery({
    queryKey: ["workspace-search", filters],
    queryFn: () => searchWorkspace(filters as SearchFilters),
    enabled: filters !== null,
    staleTime: 30_000,
  });
}

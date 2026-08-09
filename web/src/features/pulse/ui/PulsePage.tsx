import { Bot, ChevronDown, MessagesSquare } from "lucide-react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as React from "react";
import {
  listAgents,
  listProfiles,
  listWorkspaceChannels,
  type WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { subscribeToProfiles } from "@/features/profiles/profile-api";
import { Button } from "@/shared/ui/button";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  listPulsePage,
  subscribeToPulse,
  type PulseFeedPage,
} from "../pulse-api";
import {
  groupAgentPulseEvents,
  projectPulseEvents,
  pulseChannelId,
  pulseReplyParent,
  type PulseEvent,
} from "../pulse-policy";

type PulseFilter = "all" | "messages" | "forums" | "agents";

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000 - timestamp));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return new Date(timestamp * 1_000).toLocaleDateString();
}

function nameFor(
  pubkey: string,
  profiles: Map<string, WorkspaceProfile> | undefined,
) {
  return profiles?.get(pubkey)?.name ?? truncatePubkey(pubkey);
}

function pulseHref(event: PulseEvent) {
  const channelId = pulseChannelId(event);
  if (!channelId) return "/pulse";
  if (event.kind === 45001) {
    return `/channels/${encodeURIComponent(channelId)}/posts/${encodeURIComponent(event.id)}`;
  }
  if (event.kind === 45003) {
    return `/channels/${encodeURIComponent(channelId)}/posts/${encodeURIComponent(pulseReplyParent(event) ?? event.id)}`;
  }
  return `/?channel=${encodeURIComponent(channelId)}&thread=${encodeURIComponent(pulseReplyParent(event) ?? event.id)}`;
}

function PulseCard({
  event,
  profiles,
  isAgent,
}: {
  event: PulseEvent;
  profiles: Map<string, WorkspaceProfile> | undefined;
  isAgent: boolean;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isAgent ? <Bot className="size-3.5" /> : null}
        <span className="font-semibold text-foreground">
          {nameFor(event.pubkey, profiles)}
        </span>
        <span>{relativeTime(event.created_at)}</span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5">
          {event.kind === 45001
            ? "Forum post"
            : event.kind === 45003
              ? "Forum comment"
              : "Message"}
        </span>
      </div>
      <a
        className="prose prose-sm mt-3 block max-w-none break-words hover:opacity-80 dark:prose-invert"
        href={pulseHref(event)}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{event.content}</Markdown>
      </a>
    </article>
  );
}

export function PulsePage() {
  const { identity } = useWorkspaceIdentity();
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<PulseFilter>("all");
  const channelsQuery = useQuery({
    queryKey: ["workspace-channels", identity?.pubkey],
    queryFn: () => listWorkspaceChannels(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    retry: false,
  });
  const channelIds = React.useMemo(
    () => (channelsQuery.data ?? []).map((channel) => channel.id).sort(),
    [channelsQuery.data],
  );
  const channelKey = channelIds.join(",");
  const agentsQuery = useQuery({
    queryKey: ["workspace-agents", identity?.pubkey],
    queryFn: () => listAgents(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    retry: false,
  });
  const agentPubkeys = React.useMemo(
    () =>
      new Set(
        (agentsQuery.data ?? []).map((agent) => agent.pubkey.toLowerCase()),
      ),
    [agentsQuery.data],
  );
  const feedQuery = useInfiniteQuery({
    queryKey: ["pulse-events", channelKey],
    queryFn: ({ pageParam }) => listPulsePage(channelIds, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    enabled: Boolean(identity && channelIds.length),
  });
  const events = React.useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.events) ?? [],
    [feedQuery.data],
  );
  const authors = React.useMemo(
    () => [...new Set(events.map((event) => event.pubkey))].sort(),
    [events],
  );
  const profilesQuery = useQuery({
    queryKey: ["pulse-profiles", authors.join(",")],
    queryFn: () => listProfiles(authors),
    enabled: authors.length > 0,
  });

  React.useEffect(
    () =>
      subscribeToPulse(channelIds, (event) => {
        const projected = projectPulseEvents([event], channelIds)[0];
        if (!projected) return;
        queryClient.setQueryData<InfiniteData<PulseFeedPage>>(
          ["pulse-events", channelKey],
          (current) => {
            if (!current?.pages.length) return current;
            const first = current.pages[0];
            if (!first) return current;
            const merged = projectPulseEvents(
              [projected, ...first.events],
              channelIds,
            ).slice(0, 50);
            return {
              ...current,
              pages: [{ ...first, events: merged }, ...current.pages.slice(1)],
            };
          },
        );
      }),
    [channelIds, channelKey, queryClient],
  );
  React.useEffect(
    () =>
      subscribeToProfiles(authors, () => {
        void queryClient.invalidateQueries({
          queryKey: ["pulse-profiles", authors.join(",")],
        });
      }),
    [authors, queryClient],
  );

  const visibleEvents = React.useMemo(() => {
    if (filter === "messages")
      return events.filter((event) => event.kind === 9 || event.kind === 40002);
    if (filter === "forums")
      return events.filter(
        (event) => event.kind === 45001 || event.kind === 45003,
      );
    if (filter === "agents")
      return events.filter((event) =>
        agentPubkeys.has(event.pubkey.toLowerCase()),
      );
    return events;
  }, [agentPubkeys, events, filter]);
  const agentGroups = React.useMemo(
    () => groupAgentPulseEvents(visibleEvents, agentPubkeys),
    [agentPubkeys, visibleEvents],
  );

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-7">
      <header className="flex flex-wrap items-center gap-3">
        <MessagesSquare className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Pulse</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent activity from channels you can read. Private observer
            telemetry stays private.
          </p>
        </div>
      </header>
      <div
        className="mt-5 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Pulse filters"
      >
        {(["all", "messages", "forums", "agents"] as const).map((candidate) => (
          <button
            aria-selected={filter === candidate}
            className={
              filter === candidate
                ? "rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                : "rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80"
            }
            key={candidate}
            role="tab"
            type="button"
            onClick={() => setFilter(candidate)}
          >
            {candidate === "all"
              ? "All"
              : candidate === "messages"
                ? "Messages"
                : candidate === "forums"
                  ? "Forums"
                  : "Agents"}
          </button>
        ))}
      </div>
      {filter === "agents" && agentGroups.length ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {agentGroups.length} grouped agent activity windows
        </p>
      ) : null}
      {feedQuery.isError ? (
        <p className="mt-5 text-sm text-destructive">
          {feedQuery.error.message}
        </p>
      ) : null}
      <section className="mt-5 space-y-3">
        {visibleEvents.map((event) => (
          <PulseCard
            event={event}
            isAgent={agentPubkeys.has(event.pubkey.toLowerCase())}
            key={event.id}
            profiles={profilesQuery.data}
          />
        ))}
        {!feedQuery.isLoading && !visibleEvents.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No activity matches this filter yet.
          </p>
        ) : null}
      </section>
      {feedQuery.hasNextPage ? (
        <div className="mt-5 flex justify-center">
          <Button
            disabled={feedQuery.isFetchingNextPage}
            variant="outline"
            onClick={() => void feedQuery.fetchNextPage()}
          >
            <ChevronDown />{" "}
            {feedQuery.isFetchingNextPage ? "Loading…" : "Load older activity"}
          </Button>
        </div>
      ) : null}
    </main>
  );
}

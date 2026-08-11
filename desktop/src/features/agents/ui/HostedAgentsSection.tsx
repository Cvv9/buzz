import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { useIsArchivedPredicate } from "@/features/identity-archive/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { PresenceBadge } from "@/features/presence/ui/PresenceBadge";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getHostedAgentPresentation } from "@/features/agents/lib/hostedAgentPresentation";
import type { RelayAgent } from "@/shared/api/types";
import { Card } from "@/shared/ui/card";
import { SectionHeader } from "@/shared/ui/PageHeader";
import { UserAvatar } from "@/shared/ui/UserAvatar";

type HostedGroup = {
  id: "private" | "shared";
  title: string;
  description: string;
  agents: RelayAgent[];
};

export function HostedAgentsSection({
  error,
  isLoading,
  onOpenProfile,
  relayAgents,
}: {
  error: Error | null;
  isLoading: boolean;
  onOpenProfile: (pubkey: string) => void;
  relayAgents: RelayAgent[];
}) {
  const currentPubkey = useIdentityQuery().data?.pubkey.toLowerCase() ?? null;
  const isArchived = useIsArchivedPredicate();
  const visibleAgents = React.useMemo(
    () =>
      relayAgents
        .filter((agent) => !isArchived(agent.pubkey))
        .filter(
          (agent) =>
            agent.audience !== "owner" ||
            (currentPubkey !== null &&
              agent.ownerPubkey?.toLowerCase() === currentPubkey),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [currentPubkey, isArchived, relayAgents],
  );
  const profilesQuery = useUsersBatchQuery(
    visibleAgents.map((agent) => agent.pubkey),
    { enabled: visibleAgents.length > 0 },
  );
  const groups = React.useMemo<HostedGroup[]>(
    () => [
      {
        id: "private",
        title: "Private to you",
        description: "Personal and admin agents restricted to your account.",
        agents: visibleAgents.filter(
          (agent) =>
            agent.accessTier === "personal" || agent.accessTier === "admin",
        ),
      },
      {
        id: "shared",
        title: "For everyone",
        description: "Shared agents available across this community.",
        agents: visibleAgents.filter(
          (agent) =>
            agent.accessTier !== "personal" && agent.accessTier !== "admin",
        ),
      },
    ],
    [visibleAgents],
  );

  if (!isLoading && visibleAgents.length === 0 && !error) return null;

  return (
    <section className="space-y-4" data-testid="hosted-agents-section">
      <SectionHeader
        description="Agents running on Sylar’s work manager and connected to this community."
        title={`Hosted agents${visibleAgents.length > 0 ? ` (${visibleAgents.length})` : ""}`}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading hosted agents…</p>
      ) : null}

      {groups.map((group) =>
        group.agents.length > 0 ? (
          <HostedAgentGroup
            agents={group.agents}
            description={group.description}
            key={group.id}
            onOpenProfile={onOpenProfile}
            profiles={profilesQuery.data?.profiles ?? {}}
            title={group.title}
          />
        ) : null,
      )}

      {error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}

function HostedAgentGroup({
  agents,
  description,
  onOpenProfile,
  profiles,
  title,
}: {
  agents: RelayAgent[];
  description: string;
  onOpenProfile: (pubkey: string) => void;
  profiles: Record<
    string,
    { displayName: string | null; avatarUrl: string | null }
  >;
  title: string;
}) {
  const [expanded, setExpanded] = React.useState(true);

  return (
    <div className="space-y-3">
      <button
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">
            {title} ({agents.length})
          </span>
          <span className="block text-xs text-muted-foreground">
            {description}
          </span>
        </span>
      </button>

      {expanded ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border/60">
            {agents.map((agent) => {
              const profile = profiles[agent.pubkey.toLowerCase()];
              const { avatarUrl, displayName } = getHostedAgentPresentation(
                agent,
                profile,
              );
              return (
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/45"
                  data-testid={`hosted-agent-${agent.pubkey}`}
                  key={agent.pubkey}
                  onClick={() => onOpenProfile(agent.pubkey)}
                  type="button"
                >
                  <UserAvatar
                    avatarUrl={avatarUrl}
                    className="h-10 w-10 shrink-0"
                    displayName={displayName}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {displayName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {agent.accessTier === "admin"
                        ? "Admin only"
                        : agent.accessTier === "personal"
                          ? "Personal assistant"
                          : "Available to everyone"}
                    </span>
                  </span>
                  <PresenceBadge status={agent.status} />
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

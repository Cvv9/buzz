import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  FolderKanban,
  GitPullRequest,
  MessageSquare,
  PackageOpen,
} from "lucide-react";
import * as React from "react";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import {
  getBrowserProject,
  listBrowserProjects,
  listRepositoryWorkItems,
  subscribeToBrowserProjects,
  subscribeToProjectDeletions,
  subscribeToRepositoryWorkItems,
} from "../project-api";
import {
  parseProjectCoordinate,
  parseRepositoryCoordinate,
  type BrowserWorkItem,
  type ProjectContainer,
  type RepositoryActivity,
} from "../project-policy";
import { truncatePubkey } from "@/shared/lib/pubkey";

const projectsKey = ["projects", "collection"] as const;
const projectKey = (address: string) =>
  ["projects", "detail", address] as const;
const workItemsKey = (address: string) =>
  ["projects", "work-items", address] as const;

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function addressForRepo(project: ProjectContainer, index: number): string {
  return `${project.address}:${index}`;
}

function useProjectCollection() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: projectsKey,
    queryFn: listBrowserProjects,
    staleTime: 15_000,
  });
  React.useEffect(
    () =>
      subscribeToBrowserProjects(() => {
        void queryClient.invalidateQueries({ queryKey: projectsKey });
      }),
    [queryClient],
  );
  const addresses = React.useMemo(
    () =>
      (query.data?.containers ?? []).flatMap((project) => [
        project.address,
        ...project.memberAddresses,
      ]),
    [query.data?.containers],
  );
  React.useEffect(() => {
    if (!addresses.length) return;
    return subscribeToProjectDeletions(addresses, () => {
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    });
  }, [addresses, queryClient]);
  return query;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}

function LoadError({ error }: { error: unknown }) {
  return (
    <p
      className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {error instanceof Error
        ? error.message
        : "The relay did not return this project data."}
    </p>
  );
}

function IncompleteNotice({ incomplete }: { incomplete: boolean }) {
  return incomplete ? (
    <p className="mt-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      This relay history has a saturated timestamp page. Results are safe to
      read but may not be complete; refresh after the relay catches up.
    </p>
  ) : null;
}

export function ProjectsPage() {
  return (
    <WorkspaceIdentityGate>
      {() => <ProjectsPageContent />}
    </WorkspaceIdentityGate>
  );
}

function ProjectsPageContent() {
  const projectsQuery = useProjectCollection();
  return (
    <PageShell>
      <nav className="mb-8 flex items-center gap-3 text-sm text-muted-foreground">
        <a className="hover:text-foreground" href="/repos">
          Repositories
        </a>
        <span>Projects</span>
      </nav>
      <header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <FolderKanban className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Read-only NIP-MP project containers and NIP-34 repositories. The
              browser folds signed relay events; clone, checkout, and terminal
              mutation remain desktop/CLI capabilities.
            </p>
          </div>
        </div>
      </header>
      {projectsQuery.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading projects…</p>
      ) : null}
      {projectsQuery.error ? <LoadError error={projectsQuery.error} /> : null}
      {projectsQuery.data ? (
        <IncompleteNotice incomplete={projectsQuery.data.possiblyIncomplete} />
      ) : null}
      {projectsQuery.data ? (
        <section className="mt-6 grid gap-5">
          {projectsQuery.data.containers.map((project) => (
            <ProjectCard key={project.address} project={project} />
          ))}
          {projectsQuery.data.implicitRepositories.length ? (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h2 className="font-semibold">Unassigned repositories</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                No authorized NIP-MP project currently claims these
                repositories.
              </p>
              <div className="mt-4 divide-y divide-border">
                {projectsQuery.data.implicitRepositories.map((repository) => (
                  <RepositoryRow
                    key={repository.address}
                    repository={repository}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {!projectsQuery.data.containers.length &&
          !projectsQuery.data.implicitRepositories.length ? (
            <EmptyState />
          ) : null}
        </section>
      ) : null}
    </PageShell>
  );
}

function EmptyState() {
  return (
    <section className="rounded-2xl border border-dashed border-border px-5 py-12 text-center">
      <PackageOpen className="mx-auto size-7 text-muted-foreground" />
      <h2 className="mt-3 font-semibold">No published projects</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Projects appear after a signed kind 30621 or 30617 reaches this relay.
      </p>
    </section>
  );
}

function ProjectCard({ project }: { project: ProjectContainer }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            className="text-lg font-semibold hover:underline"
            params={{ projectAddress: project.address }}
            to="/projects/$projectAddress"
          >
            {project.name}
          </Link>
          <p className="mt-1 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {project.description || "No project description."}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          {project.visibility}
        </span>
      </div>
      <div className="mt-5 divide-y divide-border rounded-xl border border-border">
        {project.members.map((member, index) => (
          <div className="px-4 py-3" key={addressForRepo(project, index)}>
            {member.repository ? (
              <RepositoryRow repository={member.repository} />
            ) : (
              <UnavailableRepository address={member.coordinate.address} />
            )}
            {member.repository && !member.claimed ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Listed by this project but not authorized to suppress its
                standalone card.
              </p>
            ) : null}
          </div>
        ))}
        {!project.members.length ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            This project does not list a repository yet.
          </p>
        ) : null}
      </div>
      {project.channelId ? (
        <a
          className="mt-4 inline-block text-sm text-primary hover:underline"
          href={`/?channel=${encodeURIComponent(project.channelId)}`}
        >
          Open linked channel
        </a>
      ) : null}
    </section>
  );
}

function RepositoryRow({
  repository,
}: {
  repository: {
    address: string;
    name: string;
    description: string;
    owner: string;
  };
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{repository.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {repository.description || truncatePubkey(repository.owner)}
        </p>
      </div>
      <Link
        className="shrink-0 text-sm text-primary hover:underline"
        params={{ repositoryAddress: repository.address }}
        to="/repos/$repositoryAddress/work-items"
      >
        Work items
      </Link>
    </div>
  );
}

function UnavailableRepository({ address }: { address: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Repository unavailable:{" "}
      <code className="break-all text-xs">{address}</code>
    </p>
  );
}

export function ProjectDetailPage({
  projectAddress,
}: {
  projectAddress: string;
}) {
  return (
    <WorkspaceIdentityGate>
      {() => <ProjectDetailPageContent projectAddress={projectAddress} />}
    </WorkspaceIdentityGate>
  );
}

function ProjectDetailPageContent({
  projectAddress,
}: {
  projectAddress: string;
}) {
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: projectKey(projectAddress),
    queryFn: () => getBrowserProject(projectAddress),
    enabled: Boolean(parseProjectCoordinate(projectAddress)),
  });
  React.useEffect(
    () =>
      subscribeToBrowserProjects(() => {
        void queryClient.invalidateQueries({
          queryKey: projectKey(projectAddress),
        });
        void queryClient.invalidateQueries({ queryKey: projectsKey });
      }),
    [projectAddress, queryClient],
  );
  const deletionAddresses = React.useMemo(
    () =>
      projectQuery.data
        ? [projectQuery.data.address, ...projectQuery.data.memberAddresses]
        : [],
    [projectQuery.data],
  );
  React.useEffect(() => {
    if (!deletionAddresses.length) return;
    return subscribeToProjectDeletions(deletionAddresses, () => {
      void queryClient.invalidateQueries({
        queryKey: projectKey(projectAddress),
      });
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    });
  }, [deletionAddresses, projectAddress, queryClient]);
  if (!parseProjectCoordinate(projectAddress))
    return (
      <PageShell>
        <LoadError error="Invalid project coordinate." />
      </PageShell>
    );
  if (projectQuery.isLoading)
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">Loading project…</p>
      </PageShell>
    );
  if (projectQuery.error)
    return (
      <PageShell>
        <LoadError error={projectQuery.error} />
      </PageShell>
    );
  if (!projectQuery.data)
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">
          This project is unavailable, deleted, unlisted, or not visible on this
          relay.
        </p>
      </PageShell>
    );
  return (
    <PageShell>
      <nav className="mb-8 text-sm text-muted-foreground">
        <Link className="hover:text-foreground" to="/projects">
          Projects
        </Link>{" "}
        <span className="px-2">/</span> {projectQuery.data.name}
      </nav>
      <ProjectCard project={projectQuery.data} />
      <p className="mt-5 break-all text-xs text-muted-foreground">
        Canonical project coordinate: {projectQuery.data.address}
      </p>
    </PageShell>
  );
}

function useRepositoryWorkItems(repositoryAddress: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: workItemsKey(repositoryAddress),
    queryFn: () => listRepositoryWorkItems(repositoryAddress),
    enabled: Boolean(parseRepositoryCoordinate(repositoryAddress)),
    staleTime: 15_000,
  });
  React.useEffect(
    () =>
      subscribeToRepositoryWorkItems(repositoryAddress, () => {
        void queryClient.invalidateQueries({
          queryKey: workItemsKey(repositoryAddress),
        });
      }),
    [queryClient, repositoryAddress],
  );
  return query;
}

export function RepositoryWorkItemsPage({
  repositoryAddress,
  workItemId,
}: {
  repositoryAddress: string;
  workItemId?: string;
}) {
  return (
    <WorkspaceIdentityGate>
      {() => (
        <RepositoryWorkItemsPageContent
          repositoryAddress={repositoryAddress}
          workItemId={workItemId}
        />
      )}
    </WorkspaceIdentityGate>
  );
}

function RepositoryWorkItemsPageContent({
  repositoryAddress,
  workItemId,
}: {
  repositoryAddress: string;
  workItemId?: string;
}) {
  const workItemsQuery = useRepositoryWorkItems(repositoryAddress);
  if (!parseRepositoryCoordinate(repositoryAddress))
    return (
      <PageShell>
        <LoadError error="Invalid repository coordinate." />
      </PageShell>
    );
  return (
    <PageShell>
      <nav className="mb-8 flex gap-3 text-sm text-muted-foreground">
        <Link className="hover:text-foreground" to="/projects">
          Projects
        </Link>
        <span>/</span>
        <span>Work items</span>
      </nav>
      <header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GitPullRequest className="size-5 text-primary" /> Repository work
          items
        </h1>
        <p className="mt-2 break-all text-sm text-muted-foreground">
          {repositoryAddress}
        </p>
      </header>
      {workItemsQuery.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Loading issues, pull requests, and activity…
        </p>
      ) : null}
      {workItemsQuery.error ? <LoadError error={workItemsQuery.error} /> : null}
      {workItemsQuery.data ? (
        <>
          <IncompleteNotice
            incomplete={workItemsQuery.data.possiblyIncomplete}
          />
          {workItemId ? (
            <WorkItemDetail
              repositoryAddress={repositoryAddress}
              workItem={
                workItemsQuery.data.items.find(
                  (item) => item.id === workItemId,
                ) ?? null
              }
            />
          ) : (
            <WorkItemList
              repositoryAddress={repositoryAddress}
              items={workItemsQuery.data.items}
            />
          )}
          <ActivityList activity={workItemsQuery.data.activity} />
        </>
      ) : null}
    </PageShell>
  );
}

function WorkItemList({
  repositoryAddress,
  items,
}: {
  repositoryAddress: string;
  items: BrowserWorkItem[];
}) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="font-semibold">Issues and pull requests</h2>
      {items.length ? (
        <div className="mt-4 divide-y divide-border">
          {items.map((item) => (
            <WorkItemRow
              item={item}
              key={item.id}
              repositoryAddress={repositoryAddress}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No supported NIP-34 issues or pull requests were found.
        </p>
      )}
    </section>
  );
}

function WorkItemRow({
  repositoryAddress,
  item,
}: {
  repositoryAddress: string;
  item: BrowserWorkItem;
}) {
  return (
    <Link
      className="block py-4 hover:bg-muted/30"
      params={{ repositoryAddress, workItemId: item.id }}
      to="/repos/$repositoryAddress/work-items/$workItemId"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.title}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {item.kind}
        </span>
        <StatusBadge status={item.status} />
        <span className="ml-auto text-xs text-muted-foreground">
          {relativeTime(item.updatedAt)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {truncatePubkey(item.author)} · {item.comments.length} comment
        {item.comments.length === 1 ? "" : "s"}
      </p>
    </Link>
  );
}

function StatusBadge({ status }: { status: BrowserWorkItem["status"] }) {
  const color =
    status === "Merged"
      ? "bg-violet-500/15 text-violet-800 dark:text-violet-200"
      : status === "Closed"
        ? "bg-rose-500/15 text-rose-800 dark:text-rose-200"
        : status === "Draft"
          ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
          : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>
      {status}
    </span>
  );
}

function WorkItemDetail({
  repositoryAddress,
  workItem,
}: {
  repositoryAddress: string;
  workItem: BrowserWorkItem | null;
}) {
  if (!workItem)
    return (
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        This work item is unavailable or its root event failed strict
        validation.
      </section>
    );
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <Link
        className="text-sm text-primary hover:underline"
        params={{ repositoryAddress }}
        to="/repos/$repositoryAddress/work-items"
      >
        ← All work items
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{workItem.title}</h2>
        <StatusBadge status={workItem.status} />
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
        {workItem.content}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Opened by {truncatePubkey(workItem.author)} ·{" "}
        {relativeTime(workItem.createdAt)}
      </p>
      {workItem.kind === "pull-request" ? (
        <PullRequestSummary item={workItem} />
      ) : null}
      <CommentList comments={workItem.comments} />
    </section>
  );
}

function PullRequestSummary({ item }: { item: BrowserWorkItem }) {
  return (
    <div className="mt-5 grid gap-3 rounded-xl border border-border p-4 text-sm sm:grid-cols-3">
      <p>
        <span className="text-muted-foreground">Reviewers </span>
        {item.reviewers.length}
      </p>
      <p>
        <span className="text-muted-foreground">Approvals </span>
        {item.approvals.length}
      </p>
      <p>
        <span className="text-muted-foreground">Changes requested </span>
        {item.changeRequests.length}
      </p>
      {item.commit ? (
        <p className="break-all text-xs text-muted-foreground sm:col-span-3">
          Current commit: {item.commit}
        </p>
      ) : null}
    </div>
  );
}

function CommentList({ comments }: { comments: BrowserWorkItem["comments"] }) {
  return (
    <section className="mt-6">
      <h3 className="flex items-center gap-2 font-semibold">
        <MessageSquare className="size-4" /> Comments
      </h3>
      {comments.length ? (
        <div className="mt-3 grid gap-3">
          {comments.map((comment) => (
            <article
              className="rounded-xl border border-border p-3"
              key={comment.id}
            >
              <p className="text-xs text-muted-foreground">
                {truncatePubkey(comment.author)} ·{" "}
                {relativeTime(comment.createdAt)}
                {comment.review ? ` · ${comment.review}` : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {comment.content}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No linked comments.
        </p>
      )}
    </section>
  );
}

function ActivityList({ activity }: { activity: RepositoryActivity[] }) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="font-semibold">Activity</h2>
      {activity.length ? (
        <ol className="mt-4 divide-y divide-border">
          {activity.slice(0, 50).map((event) => (
            <li className="py-3 text-sm" key={event.id}>
              <span className="font-medium">
                {truncatePubkey(event.author)}
              </span>
              <span className="mx-2 text-muted-foreground">
                kind {event.kind}
              </span>
              <span className="text-muted-foreground">
                {relativeTime(event.createdAt)}
              </span>
              {event.content ? (
                <p className="mt-1 line-clamp-2 text-muted-foreground">
                  {event.content}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No supported repository activity.
        </p>
      )}
    </section>
  );
}

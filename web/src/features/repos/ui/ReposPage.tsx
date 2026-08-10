import { BookMarked, GitBranch, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { mockRepos } from "../mock-repos";
import { useRepos } from "../use-repos";
import { ConnectButton } from "./ConnectButton";
import { OrgSidebar } from "./OrgSidebar";
import { RepoListItem } from "./RepoListItem";

type SortOrder = "newest" | "oldest" | "name";

function RepositoriesShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}

function RepositoriesNavigation() {
  return (
    <nav
      aria-label="Repository navigation"
      className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
    >
      <Link className="hover:text-foreground" to="/">
        Workspace
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page" className="text-foreground">
        Repositories
      </span>
      <span aria-hidden="true">/</span>
      <Link className="hover:text-foreground" to="/projects">
        Projects
      </Link>
    </nav>
  );
}

function RepositoriesHeader() {
  return (
    <header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <BookMarked className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              Repositories
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Browse signed NIP-34 repository announcements from this community.
              Reading files is browser-safe; clone, checkout, and terminal
              changes remain desktop or CLI capabilities.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild size="sm" type="button" variant="outline">
            <Link to="/projects">Browse projects</Link>
          </Button>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function ListItemSkeleton() {
  return (
    <div className="py-6">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
        <div className="h-5 w-48 animate-pulse rounded bg-muted" />
        <div className="h-5 w-14 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-muted" />
      <div className="mt-2 flex gap-4">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

function SearchEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <GitBranch className="size-7" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">No matching repositories</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Try a different name or clear the search to see all repositories.
      </p>
    </div>
  );
}

function CommunityEmptyState() {
  return (
    <section className="mt-6 rounded-2xl border border-dashed border-border px-5 py-12 text-center">
      <BookMarked className="mx-auto size-7 text-muted-foreground" />
      <h2 className="mt-3 font-semibold">No repositories published yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
        Repositories appear here after a signed NIP-34 announcement reaches this
        community. You can browse related project work now, or publish from the
        Buzz desktop app or CLI when you are ready.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild type="button" variant="outline">
          <Link to="/projects">Browse projects</Link>
        </Button>
        <ConnectButton />
      </div>
    </section>
  );
}

function RepositoriesLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <section
      className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-5 sm:p-6"
      role="alert"
    >
      <h2 className="font-semibold text-destructive">
        Repositories could not be loaded
      </h2>
      <p className="mt-1 text-sm text-destructive/90">{message}</p>
      <Button
        className="mt-4"
        onClick={onRetry}
        type="button"
        variant="outline"
      >
        <RefreshCw /> Try again
      </Button>
    </section>
  );
}

export function ReposPage() {
  const preview = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("preview")
    : null;
  const showMockRepos = preview === "repositories";
  const showMockEmptyState = preview === "empty";
  const {
    data: fetchedRepos,
    error,
    isLoading: isLoadingRepos,
    refetch,
  } = useRepos({ enabled: !showMockRepos && !showMockEmptyState });
  const repos = showMockRepos
    ? mockRepos
    : showMockEmptyState
      ? []
      : fetchedRepos;
  const isLoading = preview ? false : isLoadingRepos;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("newest");

  const filteredRepos = useMemo(() => {
    if (!repos) return [];

    const term = search.toLowerCase();
    const result = repos.filter(
      (repository) =>
        repository.name.toLowerCase().includes(term) ||
        repository.description.toLowerCase().includes(term),
    );

    switch (sort) {
      case "newest":
        return result.sort((left, right) => right.createdAt - left.createdAt);
      case "oldest":
        return result.sort((left, right) => left.createdAt - right.createdAt);
      case "name":
        return result.sort((left, right) =>
          left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
          }),
        );
    }
  }, [repos, search, sort]);

  return (
    <RepositoriesShell>
      <RepositoriesNavigation />
      <RepositoriesHeader />
      {isLoading ? (
        <section
          aria-label="Loading repositories"
          className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]"
        >
          <div className="divide-y divide-border">
            {["a", "b", "c", "d", "e"].map((key) => (
              <ListItemSkeleton key={key} />
            ))}
          </div>
          <aside className="hidden border-l border-border pl-8 lg:block" />
        </section>
      ) : error ? (
        <RepositoriesLoadError
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !repos || repos.length === 0 ? (
        <CommunityEmptyState />
      ) : (
        <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                className="flex-1"
                placeholder="Find a repository..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                aria-label="Sort repositories"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOrder)}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
              </select>
            </div>
            {filteredRepos.length > 0 ? (
              <div className="mt-2 divide-y divide-border">
                {filteredRepos.map((repo) => (
                  <RepoListItem
                    key={repo.id}
                    preview={showMockRepos}
                    repo={repo}
                  />
                ))}
              </div>
            ) : (
              <SearchEmptyState />
            )}
          </div>
          <aside className="hidden border-l border-border pl-8 lg:block">
            <OrgSidebar repos={repos} />
          </aside>
        </section>
      )}
    </RepositoriesShell>
  );
}

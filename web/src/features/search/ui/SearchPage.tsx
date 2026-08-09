import * as React from "react";
import { CalendarClock, Search } from "lucide-react";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useWorkspaceSearch } from "../search-api";
import {
  type SearchFilters,
  type SearchFormFilters,
  normalizeSearchFilters,
  searchDestination,
  searchKindLabel,
} from "../search-policy";

function initialFilters(): SearchFormFilters {
  const parameters = new URLSearchParams(window.location.search);
  return {
    query: parameters.get("q") ?? "",
    channelId: parameters.get("channel") ?? undefined,
    author: parameters.get("author") ?? undefined,
    since: parameters.get("since") ?? undefined,
    until: parameters.get("until") ?? undefined,
  };
}

export function SearchPage() {
  return (
    <WorkspaceIdentityGate>{() => <SearchPageContent />}</WorkspaceIdentityGate>
  );
}

function SearchPageContent() {
  const [form, setForm] = React.useState<SearchFormFilters>(initialFilters);
  const [filters, setFilters] = React.useState<SearchFilters | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const searchQuery = useWorkspaceSearch(filters);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setFilters(normalizeSearchFilters(form));
      setValidationError(null);
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Search filters are invalid.",
      );
    }
  };

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-4xl">
        <nav className="mb-8 flex items-center gap-4 text-sm">
          <a className="text-muted-foreground hover:text-foreground" href="/">
            Workspace
          </a>
          <span className="text-foreground">Search</span>
        </nav>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Search className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Search Buzz
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Messages, forum posts, repositories, and project activity.
              </p>
            </div>
          </div>
          <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <SearchField label="Search text" required>
              <Input
                aria-label="Search text"
                autoFocus
                minLength={2}
                placeholder="Find a decision, project, or message"
                value={form.query}
                onChange={(event) =>
                  setForm({ ...form, query: event.target.value })
                }
              />
            </SearchField>
            <SearchField label="Channel ID">
              <Input
                aria-label="Channel ID"
                placeholder="Optional channel UUID or slug"
                value={form.channelId ?? ""}
                onChange={(event) =>
                  setForm({ ...form, channelId: event.target.value })
                }
              />
            </SearchField>
            <SearchField label="Author public key">
              <Input
                aria-label="Author public key"
                placeholder="64-character hex pubkey"
                value={form.author ?? ""}
                onChange={(event) =>
                  setForm({ ...form, author: event.target.value })
                }
              />
            </SearchField>
            <div className="grid grid-cols-2 gap-3">
              <SearchField label="After">
                <Input
                  aria-label="After"
                  type="datetime-local"
                  value={form.since ?? ""}
                  onChange={(event) =>
                    setForm({ ...form, since: event.target.value })
                  }
                />
              </SearchField>
              <SearchField label="Before">
                <Input
                  aria-label="Before"
                  type="datetime-local"
                  value={form.until ?? ""}
                  onChange={(event) =>
                    setForm({ ...form, until: event.target.value })
                  }
                />
              </SearchField>
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <Button type="submit">
                <Search className="size-4" /> Search
              </Button>
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarClock className="size-4" /> Up to 50 results, using a
                bounded explicit-kind NIP-50 query.
              </p>
            </div>
          </form>
          {validationError ? <SearchError message={validationError} /> : null}
          {searchQuery.isError ? (
            <SearchError
              message={
                searchQuery.error instanceof Error
                  ? searchQuery.error.message
                  : "The relay search failed."
              }
            />
          ) : null}
        </section>

        {filters && !searchQuery.isPending ? (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Results</h2>
              <span className="text-sm text-muted-foreground">
                {searchQuery.data?.length ?? 0}
              </span>
            </div>
            {searchQuery.data?.length ? (
              <div className="space-y-3">
                {searchQuery.data.map((event) => (
                  <SearchResult event={event} key={event.id} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
                No authorized results matched these filters.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function SearchResult({
  event,
}: {
  event: {
    id: string;
    kind: number;
    pubkey: string;
    created_at: number;
    tags: string[][];
    content: string;
  };
}) {
  const destination = searchDestination(event);
  const date = new Date(event.created_at * 1_000).toLocaleString();
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
          {searchKindLabel(event.kind)}
        </span>
        <a
          className="font-mono hover:text-foreground"
          href={`/profiles/${event.pubkey}`}
        >
          {truncatePubkey(event.pubkey)}
        </a>
        <time dateTime={new Date(event.created_at * 1_000).toISOString()}>
          {date}
        </time>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
        {event.content || "No text content on this event."}
      </p>
      <div className="mt-4">
        {destination.kind === "unavailable" ? (
          <span className="text-sm text-muted-foreground">
            {destination.label}
          </span>
        ) : (
          <a
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href={destination.href}
          >
            {destination.label}
          </a>
        )}
      </div>
    </article>
  );
}

function SearchField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="block text-sm font-medium">
      <span className="mb-2 block">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </div>
  );
}

function SearchError({ message }: { message: string }) {
  return (
    <p
      className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {message}
    </p>
  );
}

import { ArrowLeft, Check, Search } from "lucide-react";
import * as React from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type {
  WorkspaceCommunityMember,
  WorkspaceProfile,
} from "../workspace-api";

export function WorkspaceNewMessage({
  members,
  profiles,
  onBack,
  onOpen,
  opening,
  error,
}: {
  members: WorkspaceCommunityMember[];
  profiles: Map<string, WorkspaceProfile> | undefined;
  onBack: () => void;
  onOpen: (recipients: string[], content: string) => void;
  opening: boolean;
  error: Error | null;
}) {
  const [query, setQuery] = React.useState("");
  const [recipients, setRecipients] = React.useState<string[]>([]);
  const [content, setContent] = React.useState("");
  const candidates = members.filter((member) => {
    const profile = profiles?.get(member.pubkey);
    const haystack = `${profile?.name ?? ""} ${member.pubkey}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const toggleRecipient = (pubkey: string) => {
    setRecipients((current) => {
      if (current.includes(pubkey))
        return current.filter((item) => item !== pubkey);
      return current.length >= 8 ? current : [...current, pubkey];
    });
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="new-message-page"
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        <Button
          aria-label="Back to workspace"
          size="icon"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-sm font-semibold">New message</h1>
          <p className="text-xs text-muted-foreground">
            Choose up to eight people.
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <label
          className="mb-2 block text-sm font-medium"
          htmlFor="dm-recipient-search"
        >
          To
        </label>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            id="dm-recipient-search"
            placeholder="Search people and agents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {recipients.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {recipients.length} recipient{recipients.length === 1 ? "" : "s"}{" "}
            selected
          </p>
        ) : null}
        <div className="mt-3 max-w-xl divide-y divide-border overflow-hidden rounded-lg border border-border">
          {candidates.length ? (
            candidates.map((member) => {
              const selected = recipients.includes(member.pubkey);
              const profile = profiles?.get(member.pubkey);
              return (
                <button
                  aria-pressed={selected}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  key={member.pubkey}
                  type="button"
                  onClick={() => toggleRecipient(member.pubkey)}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted-foreground">
                    {selected ? (
                      <Check className="size-4" />
                    ) : (
                      (profile?.name ?? member.pubkey).slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {profile?.name ?? member.pubkey}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {member.pubkey}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              No matching people or agents.
            </p>
          )}
        </div>
        <label
          className="mb-2 mt-6 block text-sm font-medium"
          htmlFor="first-dm-message"
        >
          Message{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          className="block min-h-28 w-full max-w-xl rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          id="first-dm-message"
          placeholder="Start the conversation"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        {error ? (
          <p className="mt-3 text-sm text-destructive">{error.message}</p>
        ) : null}
      </div>
      <footer className="flex shrink-0 justify-end border-t border-border px-4 py-3 sm:px-6">
        <Button
          disabled={!recipients.length || opening}
          onClick={() => onOpen(recipients, content)}
        >
          {opening ? "Opening…" : "Open conversation"}
        </Button>
      </footer>
    </section>
  );
}

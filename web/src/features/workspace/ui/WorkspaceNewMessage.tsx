import { ArrowLeft, Check, Plus, Search } from "lucide-react";
import * as React from "react";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type {
  WorkspaceCommunityMember,
  WorkspaceProfile,
} from "../workspace-api";
import { ProfileAvatar } from "./WorkspaceSidebar";

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
  const profileFor = (member: WorkspaceCommunityMember): WorkspaceProfile =>
    profiles?.get(member.pubkey) ??
    profiles?.get(member.pubkey.toLowerCase()) ?? {
      pubkey: member.pubkey,
      name: truncatePubkey(member.pubkey),
    };
  const candidates = members.filter((member) => {
    const profile = profileFor(member);
    const haystack = `${profile.name} ${member.pubkey}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const groupMode = recipients.length > 0;

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
            Pick a person to open your conversation, or build a group of up to
            eight.
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
            autoFocus
            className="pl-9"
            id="dm-recipient-search"
            placeholder="Search people and agents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {groupMode ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Group of {recipients.length + 1} — select more people or open the
            conversation below.
          </p>
        ) : null}
        <div className="mt-3 max-w-xl divide-y divide-border overflow-hidden rounded-lg border border-border">
          {candidates.length ? (
            candidates.map((member) => {
              const selected = recipients.includes(member.pubkey);
              const profile = profileFor(member);
              return (
                <div
                  className="flex w-full items-center gap-3 px-3 py-2.5 hover:bg-accent"
                  key={member.pubkey}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    disabled={opening}
                    type="button"
                    onClick={() =>
                      groupMode
                        ? toggleRecipient(member.pubkey)
                        : onOpen([member.pubkey], "")
                    }
                  >
                    <ProfileAvatar profile={profile} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {profile.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {profile.isAgent
                          ? "AI agent"
                          : member.role === "owner" || member.role === "admin"
                            ? "Workspace admin"
                            : "Teammate"}
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={
                      selected
                        ? `Remove ${profile.name} from the group`
                        : `Add ${profile.name} to a group conversation`
                    }
                    aria-pressed={selected}
                    className={
                      selected
                        ? "rounded-md bg-primary/15 p-1.5 text-primary"
                        : "rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                    }
                    disabled={opening}
                    title={selected ? "Remove from group" : "Add to group"}
                    type="button"
                    onClick={() => toggleRecipient(member.pubkey)}
                  >
                    {selected ? (
                      <Check className="size-4" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              No matching people or agents.
            </p>
          )}
        </div>
        {groupMode ? (
          <>
            <label
              className="mb-2 mt-6 block text-sm font-medium"
              htmlFor="first-dm-message"
            >
              Message{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <textarea
              className="block min-h-28 w-full max-w-xl rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
              id="first-dm-message"
              placeholder="Start the conversation"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-destructive">{error.message}</p>
        ) : null}
        {opening ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Opening the conversation…
          </p>
        ) : null}
      </div>
      {groupMode ? (
        <footer className="flex shrink-0 justify-end border-t border-border px-4 py-3 sm:px-6">
          <Button
            disabled={opening}
            onClick={() => onOpen(recipients, content)}
          >
            {opening ? "Opening…" : "Open group conversation"}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

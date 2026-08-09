import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { LinkIcon, Search, UserRound } from "lucide-react";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import {
  listAgents,
  type WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import { ProfileAvatar } from "@/features/workspace/ui/WorkspaceSidebar";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  type ProfileDetail,
  profileFromEvent,
  publishProfile,
  publishUserStatus,
  userStatusFromEvent,
} from "../profile-api";
import { profileDetailQueryKey, useProfileDetail } from "../useProfileDetail";

function validPubkey(pubkey: string): boolean {
  return /^[0-9a-f]{64}$/.test(pubkey.toLowerCase());
}

export function ProfilePage({ pubkey }: { pubkey: string }) {
  const normalizedPubkey = pubkey.toLowerCase();
  if (!validPubkey(normalizedPubkey)) {
    return <InvalidProfilePage />;
  }
  return (
    <WorkspaceIdentityGate>
      {(identity) => (
        <ProfilePageContent
          pubkey={normalizedPubkey}
          viewerPubkey={identity.pubkey.toLowerCase()}
        />
      )}
    </WorkspaceIdentityGate>
  );
}

function InvalidProfilePage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Profile not found</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          A Buzz profile URL needs a 64-character public key.
        </p>
        <a
          className="mt-5 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
          href="/"
        >
          Return to workspace
        </a>
      </div>
    </main>
  );
}

function ProfilePageContent({
  pubkey,
  viewerPubkey,
}: {
  pubkey: string;
  viewerPubkey: string;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useProfileDetail(pubkey);
  const agentsQuery = useQuery({
    queryKey: ["workspace-agents", viewerPubkey],
    queryFn: () => listAgents(viewerPubkey),
    retry: false,
    staleTime: 60_000,
  });
  const agent = agentsQuery.data?.find(
    (candidate) => candidate.pubkey.toLowerCase() === pubkey,
  );
  const detail = detailQuery.data;
  const presentation = resolvedPresentation(detail, agent, pubkey);
  const isOwnProfile = viewerPubkey === pubkey;
  const canEdit = isOwnProfile && !agentsQuery.isLoading && !agent;
  const [draft, setDraft] = React.useState(() => profileDraft(detail));
  const [statusDraft, setStatusDraft] = React.useState(() =>
    statusDraftFor(detail),
  );
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!detail) return;
    setDraft(profileDraft(detail));
  }, [detail]);
  React.useEffect(() => {
    if (!detail) return;
    setStatusDraft(statusDraftFor(detail));
  }, [detail]);

  const profileMutation = useMutation({
    mutationFn: () => publishProfile(pubkey, draft),
    onSuccess: (event) => {
      queryClient.setQueryData<ProfileDetail>(
        profileDetailQueryKey(pubkey),
        (current) => ({
          profile: profileFromEvent(event, pubkey),
          status: current?.status ?? null,
          profileEvent: event,
          statusEvent: current?.statusEvent,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ["workspace-profiles"] });
      setNotice(
        "Profile saved. Teammates will see it as their profile cache refreshes.",
      );
    },
  });
  const statusMutation = useMutation({
    mutationFn: (input: { text: string; emoji: string }) =>
      publishUserStatus(input),
    onSuccess: (event) => {
      queryClient.setQueryData<ProfileDetail>(
        profileDetailQueryKey(pubkey),
        (current) => ({
          profile:
            current?.profile ??
            detail?.profile ??
            profileFromEvent(undefined, pubkey),
          status: userStatusFromEvent(event),
          profileEvent: current?.profileEvent,
          statusEvent: event,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ["user-status"] });
      setNotice(
        event.content || event.tags.some((tag) => tag[0] === "emoji")
          ? "Status updated."
          : "Status cleared.",
      );
    },
  });

  if (detailQuery.isLoading) {
    return <ProfileLoading />;
  }
  if (detailQuery.isError) {
    return <ProfileError error={detailQuery.error} />;
  }

  const mutationError = profileMutation.error ?? statusMutation.error;
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-8 flex flex-wrap items-center gap-4 text-sm">
          <a className="text-muted-foreground hover:text-foreground" href="/">
            Workspace
          </a>
          <a
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            href="/search"
          >
            <Search className="size-4" /> Search
          </a>
        </nav>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <ProfileAvatar profile={presentation} size="md" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight">
                    {presentation.name}
                  </h1>
                  {agent ? (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                      Agent
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {truncatePubkey(pubkey)}
                </p>
                {detail?.status ? <StatusLine status={detail.status} /> : null}
              </div>
            </div>
            <a
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              href={`/search?author=${encodeURIComponent(pubkey)}`}
            >
              <Search className="size-4" /> Find messages
            </a>
          </div>

          {presentation.about ? (
            <p className="mt-6 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {presentation.about}
            </p>
          ) : null}
          {presentation.aliases?.length ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Also known as {presentation.aliases.join(", ")}
            </p>
          ) : null}
        </section>

        {canEdit ? (
          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <ProfileEditor
              draft={draft}
              error={profileMutation.error}
              pending={profileMutation.isPending}
              onChange={setDraft}
              onSave={() => profileMutation.mutate()}
            />
            <StatusEditor
              draft={statusDraft}
              error={statusMutation.error}
              pending={statusMutation.isPending}
              onChange={setStatusDraft}
              onClear={() => statusMutation.mutate({ text: "", emoji: "" })}
              onSave={() => statusMutation.mutate(statusDraft)}
            />
          </section>
        ) : null}

        {isOwnProfile && agent ? (
          <p className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-950 dark:text-amber-100">
            This is an agent identity. Its visible name and avatar come from the
            hosted or managed agent projection, not from kind 0. Edit it from
            the agent controls so historical messages keep the canonical
            presentation.
          </p>
        ) : null}
        {notice ? (
          <p className="mt-5 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
            {notice}
          </p>
        ) : null}
        {mutationError ? (
          <p
            className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {mutationError instanceof Error
              ? mutationError.message
              : "The relay could not save this change."}
          </p>
        ) : null}
      </div>
    </main>
  );
}

function resolvedPresentation(
  detail: ProfileDetail | undefined,
  agent: WorkspaceProfile | undefined,
  pubkey: string,
): WorkspaceProfile {
  if (agent) return agent;
  return {
    ...(detail?.profile ?? {
      pubkey,
      name: truncatePubkey(pubkey),
      aliases: [],
    }),
    isAgent: false,
  };
}

function profileDraft(detail: ProfileDetail | undefined) {
  return {
    name: detail?.profile.name ?? "",
    picture: detail?.profile.picture ?? "",
    about: detail?.profile.about ?? "",
  };
}

function statusDraftFor(detail: ProfileDetail | undefined) {
  return {
    emoji: detail?.status?.emoji ?? "",
    text: detail?.status?.text ?? "",
  };
}

function StatusLine({
  status,
}: {
  status: NonNullable<ProfileDetail["status"]>;
}) {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      <span aria-label="Current status" role="img">
        {status.emoji || "●"}
      </span>
      <span>{status.text || "Status set"}</span>
    </p>
  );
}

function ProfileEditor({
  draft,
  pending,
  error,
  onChange,
  onSave,
}: {
  draft: { name: string; picture: string; about: string };
  pending: boolean;
  error: unknown;
  onChange: (draft: { name: string; picture: string; about: string }) => void;
  onSave: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <UserRound className="size-4 text-primary" />
        <h2 className="font-semibold">Edit profile</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Saved as a merged kind 0 profile, preserving fields that this form does
        not own.
      </p>
      <div className="mt-5 space-y-4">
        <FormField label="Display name">
          <Input
            aria-label="Display name"
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
          />
        </FormField>
        <FormField label="Picture URL">
          <Input
            aria-label="Picture URL"
            placeholder="https://…"
            value={draft.picture}
            onChange={(event) =>
              onChange({ ...draft, picture: event.target.value })
            }
          />
        </FormField>
        <FormField label="About">
          <textarea
            aria-label="About"
            className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            value={draft.about}
            onChange={(event) =>
              onChange({ ...draft, about: event.target.value })
            }
          />
        </FormField>
      </div>
      <Button
        className="mt-5"
        disabled={pending || !draft.name.trim()}
        onClick={onSave}
        type="button"
      >
        {pending ? "Saving…" : "Save profile"}
      </Button>
      {error ? <InlineError error={error} /> : null}
    </section>
  );
}

function StatusEditor({
  draft,
  pending,
  error,
  onChange,
  onSave,
  onClear,
}: {
  draft: { emoji: string; text: string };
  pending: boolean;
  error: unknown;
  onChange: (draft: { emoji: string; text: string }) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <LinkIcon className="size-4 text-primary" />
        <h2 className="font-semibold">Current status</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        A kind 30315 event with the <code>d=general</code> identifier. Clearing
        publishes an empty replacement event.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-[6rem_1fr]">
        <FormField label="Emoji">
          <Input
            aria-label="Status emoji"
            maxLength={16}
            placeholder="💬"
            value={draft.emoji}
            onChange={(event) =>
              onChange({ ...draft, emoji: event.target.value })
            }
          />
        </FormField>
        <FormField label="Message">
          <Input
            aria-label="Status message"
            maxLength={280}
            placeholder="In a focus session"
            value={draft.text}
            onChange={(event) =>
              onChange({ ...draft, text: event.target.value })
            }
          />
        </FormField>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button disabled={pending} onClick={onSave} type="button">
          {pending ? "Updating…" : "Set status"}
        </Button>
        <Button
          disabled={pending}
          onClick={onClear}
          type="button"
          variant="outline"
        >
          Clear status
        </Button>
      </div>
      {error ? <InlineError error={error} /> : null}
    </section>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block text-sm font-medium">
      <span className="mb-2 block">{label}</span>
      {children}
    </div>
  );
}

function InlineError({ error }: { error: unknown }) {
  return (
    <p className="mt-4 text-sm text-destructive" role="alert">
      {error instanceof Error
        ? error.message
        : "The relay rejected this change."}
    </p>
  );
}

function ProfileLoading() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background text-muted-foreground">
      Loading profile…
    </main>
  );
}

function ProfileError({ error }: { error: unknown }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Profile unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "The relay did not return this profile."}
        </p>
        <a
          className="mt-5 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
          href="/"
        >
          Return to workspace
        </a>
      </div>
    </main>
  );
}

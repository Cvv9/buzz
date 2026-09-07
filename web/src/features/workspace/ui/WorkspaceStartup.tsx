import { useNavigate } from "@tanstack/react-router";
import { WorkspaceLoadError } from "@/features/access/WorkspaceLoadError";
import type {
  BrowserIdentity,
  StoredBrowserIdentitySummary,
} from "@/shared/lib/browser-identity";
import { IdentityGate } from "./IdentityGate";
import { EmptyMembership } from "./EmptyMembership";

/** Separates account, connection and membership states during workspace startup. */
export function WorkspaceStartup({
  identity,
  identityError,
  identityLoading,
  storedIdentity,
  onRetryIdentity,
  channelsPending,
  channelsError,
  onRetryChannels,
  onReady,
}: {
  identity: BrowserIdentity | null;
  identityError: Error | null;
  identityLoading: boolean;
  storedIdentity: StoredBrowserIdentitySummary | null;
  onRetryIdentity: () => void;
  channelsPending: boolean;
  channelsError: boolean;
  onRetryChannels: () => Promise<void>;
  onReady: (identity: BrowserIdentity) => void;
}) {
  const navigate = useNavigate();
  if (identityError)
    return (
      <WorkspaceLoadError
        title="Could not open your saved account"
        description="Buzz could not read this browser’s account storage. Your account has not been removed. Close other Buzz tabs and try again; you do not need to create a new account."
        onRetry={onRetryIdentity}
      />
    );
  if (identityLoading)
    return <LoadingWorkspace>Opening VarVik Studios…</LoadingWorkspace>;
  if (!identity) {
    const pendingInvitePath = sessionStorage.getItem(
      "buzz.web.pending-invite-path",
    );
    return (
      <IdentityGate
        pendingInvite={Boolean(pendingInvitePath)}
        storedIdentity={storedIdentity}
        onReady={(readyIdentity) => {
          onReady(readyIdentity);
          if (pendingInvitePath) {
            sessionStorage.removeItem("buzz.web.pending-invite-path");
            const match = pendingInvitePath.match(/^\/invite\/([^/]+)$/);
            if (match?.[1])
              void navigate({
                to: "/invite/$code",
                params: { code: decodeURIComponent(match[1]) },
              });
          }
        }}
      />
    );
  }
  if (channelsError)
    return (
      <WorkspaceLoadError
        title="Could not connect to your workspace"
        description="Your saved account is still available. Check your connection and try again to load your channels."
        onRetry={() => {
          void onRetryChannels();
        }}
      />
    );
  if (channelsPending)
    return <LoadingWorkspace>Connecting to VarVik Studios…</LoadingWorkspace>;
  return <EmptyMembership onJoined={onRetryChannels} />;
}

function LoadingWorkspace({ children }: { children: string }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground"
      role="status"
    >
      {children}
    </div>
  );
}

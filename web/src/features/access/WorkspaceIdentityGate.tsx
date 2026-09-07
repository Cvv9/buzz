import { WorkspaceLoadError } from "@/features/access/WorkspaceLoadError";
import { useQueryClient } from "@tanstack/react-query";
import type * as React from "react";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { IdentityGate } from "@/features/workspace/ui/IdentityGate";
import type { BrowserIdentity } from "@/shared/lib/browser-identity";

/**
 * Makes an independently addressable workspace route use the same encrypted
 * browser identity as the workspace home. It deliberately does not duplicate
 * membership or agent-directory state from WorkspacePage.
 */
export function WorkspaceIdentityGate({
  children,
}: {
  children: (identity: BrowserIdentity) => React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const {
    identity,
    identityLoading,
    identityError,
    retryIdentity,
    setIdentity,
    setStoredIdentity,
    storedIdentity,
  } = useWorkspaceIdentity();

  if (identityError) {
    return (
      <WorkspaceLoadError
        title="Could not open your saved account"
        description="Buzz could not read this browser’s account storage. Your account has not been removed. Close other Buzz tabs and try again; you do not need to create a new account."
        onRetry={retryIdentity}
      />
    );
  }
  if (identityLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#151713] text-white/55">
        Opening VarVik Studios…
      </div>
    );
  }

  if (!identity) {
    return (
      <IdentityGate
        pendingInvite={false}
        storedIdentity={storedIdentity}
        onReady={(readyIdentity) => {
          queryClient.clear();
          setIdentity(readyIdentity);
          setStoredIdentity({ ...readyIdentity, protection: "password" });
        }}
      />
    );
  }

  return <>{children(identity)}</>;
}

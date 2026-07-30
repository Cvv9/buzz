import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { claimInviteInBrowser } from "@/features/invite/invite-api";
import { createWorkspaceChannel } from "@/features/workspace/workspace-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function EmptyMembership({
  onJoined,
}: {
  onJoined: () => Promise<void> | void;
}) {
  const [code, setCode] = React.useState("");
  const [firstChannelName, setFirstChannelName] = React.useState("general");
  const [error, setError] = React.useState<string | null>(null);
  const claim = useMutation({
    mutationFn: () => claimInviteInBrowser(code.trim()),
    onSuccess: () => void onJoined(),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Could not join."),
  });
  const createFirstChannel = useMutation({
    mutationFn: () =>
      createWorkspaceChannel(firstChannelName, "Team workspace"),
    onSuccess: () => void onJoined(),
    onError: () =>
      setError(
        "Only the workspace owner can create the first channel. Use an invite code to join.",
      ),
  });
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f5ee] px-5 dark:bg-[#151713]">
      <div className="w-full max-w-md">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[#d7d72e] font-black text-[#171912]">
          V
        </div>
        <h1 className="mt-7 text-3xl font-semibold tracking-tight">
          Open VarVik Studios
        </h1>
        <p className="mt-3 leading-7 text-black/55 dark:text-white/50">
          If this is the owner identity, create the first channel. Otherwise,
          enter the invite code supplied by an administrator.
        </p>
        <form
          className="mt-7 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            createFirstChannel.mutate();
          }}
        >
          <Input
            aria-label="First channel name"
            className="h-12"
            value={firstChannelName}
            onChange={(event) => setFirstChannelName(event.target.value)}
          />
          <Button
            className="h-12 w-full bg-[#d7d72e] text-[#171912] hover:bg-[#e5e54d]"
            disabled={!firstChannelName.trim() || createFirstChannel.isPending}
            type="submit"
          >
            {createFirstChannel.isPending
              ? "Creating channel…"
              : "Create first channel"}
          </Button>
        </form>
        <div className="my-6 flex items-center gap-3 text-xs text-black/35 dark:text-white/30">
          <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
          or join an existing workspace
          <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
        </div>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            claim.mutate();
          }}
        >
          <Input
            autoFocus
            className="h-12"
            placeholder="Invite code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button
            className="h-12 w-full bg-[#d7d72e] text-[#171912] hover:bg-[#e5e54d]"
            disabled={!code.trim() || claim.isPending}
            type="submit"
          >
            {claim.isPending ? "Joining…" : "Join workspace"}
          </Button>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}

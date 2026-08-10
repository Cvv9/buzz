import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listProfiles,
  listWorkspaceCommunityMembers,
} from "@/features/workspace/workspace-api";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { BrowserSettingsBreadcrumb } from "@/features/settings/ui/BrowserSettingsBreadcrumb";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  listArchivedIdentitySnapshot,
  requestIdentityArchive,
  subscribeToArchivedIdentitySnapshot,
} from "../identity-archive-api";
import {
  canManageIdentityArchive,
  normalizeArchivePubkey,
} from "../identity-archive-policy";

export function IdentityArchivePage() {
  const { identity } = useWorkspaceIdentity();
  const queryClient = useQueryClient();
  const [targetPubkey, setTargetPubkey] = React.useState("");
  const [reason, setReason] = React.useState("");
  const membersQuery = useQuery({
    queryKey: ["workspace-community-members"],
    queryFn: listWorkspaceCommunityMembers,
    enabled: Boolean(identity),
  });
  const role = membersQuery.data?.find(
    (member) => member.pubkey === identity?.pubkey.toLowerCase(),
  )?.role;
  const memberPubkeys = React.useMemo(
    () => membersQuery.data?.map((member) => member.pubkey) ?? [],
    [membersQuery.data],
  );
  const profilesQuery = useQuery({
    queryKey: ["identity-archive-profiles", memberPubkeys.sort().join(",")],
    queryFn: () => listProfiles(memberPubkeys),
    enabled: memberPubkeys.length > 0,
  });
  const profileName = (pubkey: string) =>
    profilesQuery.data?.get(pubkey)?.name ?? truncatePubkey(pubkey);
  const snapshotQuery = useQuery({
    queryKey: ["archived-identities"],
    queryFn: listArchivedIdentitySnapshot,
    enabled: Boolean(identity),
  });
  React.useEffect(
    () =>
      subscribeToArchivedIdentitySnapshot((snapshot) =>
        queryClient.setQueryData(["archived-identities"], snapshot),
      ),
    [queryClient],
  );
  const mutation = useMutation({
    mutationFn: requestIdentityArchive,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["archived-identities"] }),
  });
  let validTarget: string | null = null;
  try {
    validTarget = targetPubkey.trim()
      ? normalizeArchivePubkey(targetPubkey)
      : null;
  } catch {
    validTarget = null;
  }
  const mayManage = Boolean(
    validTarget &&
      canManageIdentityArchive({
        targetPubkey: validTarget,
        viewerPubkey: identity?.pubkey,
        communityRole: role,
      }),
  );
  const archived = validTarget
    ? snapshotQuery.data?.archived.has(validTarget)
    : false;
  const submit = () => {
    if (!validTarget || !mayManage) return;
    const action = archived ? "unarchive" : "archive";
    if (
      window.confirm(
        `${action === "archive" ? "Archive" : "Unarchive"} this identity on the relay?`,
      )
    )
      mutation.mutate({ action, targetPubkey: validTarget, reason });
  };
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-7">
      <BrowserSettingsBreadcrumb current="Identity archive" />
      <h1 className="text-2xl font-semibold">Identity archive</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This relay-signed list is presentation state, not a ban or a
        channel-membership change. Archived people can still see their own state
        and self-unarchive.
      </p>
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <label className="block text-sm font-medium" htmlFor="archive-pubkey">
          Identity pubkey
        </label>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          id="archive-pubkey"
          list="archive-community-members"
          placeholder="Choose a community member or paste a public key"
          value={targetPubkey}
          onChange={(event) => setTargetPubkey(event.target.value)}
        />
        <datalist id="archive-community-members">
          {membersQuery.data?.map((member) => (
            <option
              key={member.pubkey}
              label={`${profileName(member.pubkey)} · ${truncatePubkey(member.pubkey)}`}
              value={member.pubkey}
            />
          ))}
        </datalist>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Community members appear by name; pasting another public key remains
          available for relay-authorized archive requests.
        </p>
        <label
          className="mt-3 block text-sm font-medium"
          htmlFor="archive-reason"
        >
          Reason code (optional)
        </label>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          id="archive-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button
          className="mt-3"
          disabled={!mayManage || mutation.isPending}
          type="button"
          onClick={submit}
        >
          {archived ? "Unarchive identity" : "Archive identity"}
        </Button>
        {validTarget && !mayManage ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Only this identity, or a community owner/admin, can request this in
            the browser. The NIP-OA owner path remains desktop-only because it
            requires a verified owner authorization tag.
          </p>
        ) : null}
        {mutation.isError ? (
          <p className="mt-3 text-sm text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
      </section>
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">
          Relay-signed archived identities
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {[...(snapshotQuery.data?.archived ?? [])].sort().map((pubkey) => (
            <li className="rounded-md bg-muted p-2" key={pubkey}>
              <span className="font-medium">{profileName(pubkey)}</span>
              <code className="ml-2 text-xs text-muted-foreground">
                {truncatePubkey(pubkey)}
              </code>
              {pubkey === identity?.pubkey.toLowerCase() ? (
                <span className="ml-2 font-medium text-foreground">(you)</span>
              ) : null}
            </li>
          ))}
          {snapshotQuery.data && !snapshotQuery.data.archived.size ? (
            <li className="text-muted-foreground">
              No identities are archived.
            </li>
          ) : null}
          {!snapshotQuery.data ? (
            <li className="text-muted-foreground">
              No verified archive snapshot is available.
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}

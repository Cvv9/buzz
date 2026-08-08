import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  addWorkspaceMember,
  archiveWorkspaceChannel,
  changeWorkspaceMemberRole,
  deleteWorkspaceChannel,
  listProfiles,
  listWorkspaceChannelMembers,
  listWorkspaceCommunityMembers,
  removeWorkspaceMember,
  type WorkspaceChannel,
  type WorkspaceChannelMember,
  updateWorkspaceChannel,
} from "../workspace-api";
import {
  changedWorkspaceChannelUpdate,
  workspaceChannelDraft,
} from "../workspace-channel-update-policy";

const MEMBER_ROLES = ["admin", "member", "guest", "bot"] as const;

function isCommunityManager(
  viewerPubkey: string,
  members: Array<{ pubkey: string; role: string }>,
) {
  return members.some(
    (member) =>
      member.pubkey === viewerPubkey.toLowerCase() &&
      (member.role === "owner" || member.role === "admin"),
  );
}

/**
 * Browser editor for the NIP-29 channel catalog. All mutations publish signed
 * Nostr events; the relay remains the authorization and shared-state source.
 */
export function WorkspaceChannelSettings({
  channel,
  viewerPubkey,
  onClose,
  onUpdated,
}: {
  channel: WorkspaceChannel;
  viewerPubkey: string;
  onClose: () => void;
  onUpdated: () => Promise<WorkspaceChannel[]> | undefined;
}) {
  const [name, setName] = React.useState(channel.name);
  const [about, setAbout] = React.useState(channel.about);
  const [catalogSection, setCatalogSection] = React.useState(
    channel.catalogSection,
  );
  const [visibility, setVisibility] = React.useState(channel.visibility);
  const [invitee, setInvitee] = React.useState("");
  const [inviteRole, setInviteRole] =
    React.useState<(typeof MEMBER_ROLES)[number]>("member");

  const communityQuery = useQuery({
    queryKey: ["workspace-community-members"],
    queryFn: listWorkspaceCommunityMembers,
  });
  const membersQuery = useQuery({
    queryKey: ["workspace-channel-members", channel.id],
    queryFn: () => listWorkspaceChannelMembers(channel.id),
  });
  const communityMembers = communityQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const canManage =
    channel.role === "owner" ||
    channel.role === "admin" ||
    isCommunityManager(viewerPubkey, communityMembers);
  const canInvite =
    channel.type !== "dm" && (channel.visibility === "public" || canManage);
  const canDelete =
    channel.role === "owner" ||
    isCommunityManager(viewerPubkey, communityMembers);

  const profilePubkeys = React.useMemo(
    () => [
      ...new Set(
        [...communityMembers, ...members].map((member) => member.pubkey),
      ),
    ],
    [communityMembers, members],
  );
  const profilesQuery = useQuery({
    queryKey: ["workspace-settings-profiles", profilePubkeys.sort().join(",")],
    queryFn: () => listProfiles(profilePubkeys),
    enabled: profilePubkeys.length > 0,
  });
  const profileName = (pubkey: string) =>
    profilesQuery.data?.get(pubkey)?.name ?? truncatePubkey(pubkey);

  const resetDraft = React.useCallback((nextChannel: WorkspaceChannel) => {
    const draft = workspaceChannelDraft(nextChannel);
    setName(draft.name);
    setAbout(draft.about);
    setCatalogSection(draft.catalogSection);
    setVisibility(draft.visibility);
  }, []);

  const refresh = async () => {
    await Promise.all([membersQuery.refetch(), communityQuery.refetch()]);
    const channels = await onUpdated();
    const refreshed = channels?.find(
      (candidate) => candidate.id === channel.id,
    );
    if (refreshed) resetDraft(refreshed);
  };
  const editMutation = useMutation({
    mutationFn: () => {
      const update = changedWorkspaceChannelUpdate(channel, {
        name,
        about,
        catalogSection,
        visibility,
      });
      if (Object.keys(update).length === 0) return Promise.resolve(null);
      return updateWorkspaceChannel(channel.id, update);
    },
    onSuccess: refresh,
  });
  const inviteMutation = useMutation({
    mutationFn: () =>
      addWorkspaceMember(
        channel.id,
        invitee,
        canManage ? inviteRole : "member",
      ),
    onSuccess: async () => {
      setInvitee("");
      await refresh();
    },
  });
  const roleMutation = useMutation({
    mutationFn: ({
      pubkey,
      role,
    }: {
      pubkey: string;
      role: (typeof MEMBER_ROLES)[number];
    }) => changeWorkspaceMemberRole(channel.id, pubkey, role),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: (pubkey: string) => removeWorkspaceMember(channel.id, pubkey),
    onSuccess: refresh,
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveWorkspaceChannel(channel.id),
    onSuccess: async () => {
      await onUpdated();
      onClose();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkspaceChannel(channel.id),
    onSuccess: async () => {
      await onUpdated();
      onClose();
    },
  });
  const error =
    editMutation.error ||
    inviteMutation.error ||
    roleMutation.error ||
    removeMutation.error ||
    archiveMutation.error ||
    deleteMutation.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-background p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">
              Shared channel catalog
            </p>
            <h2 className="mt-1 text-xl font-semibold">Channel settings</h2>
          </div>
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            Close
          </Button>
        </div>

        {canManage ? (
          <form
            className="mt-6 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              editMutation.mutate();
            }}
          >
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="workspace-channel-name"
            >
              Name
              <Input
                id="workspace-channel-name"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="workspace-channel-description"
            >
              Description
              <Input
                id="workspace-channel-description"
                onChange={(event) => setAbout(event.target.value)}
                value={about}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="workspace-channel-catalog-section"
            >
              Catalog section
              <Input
                id="workspace-channel-catalog-section"
                maxLength={80}
                onChange={(event) => setCatalogSection(event.target.value)}
                placeholder="e.g. Command Center"
                value={catalogSection}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Visibility
              <select
                className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                onChange={(event) =>
                  setVisibility(event.target.value as "public" | "private")
                }
                value={visibility}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </label>
            <div className="flex justify-end">
              <Button
                disabled={editMutation.isPending || !name.trim()}
                type="submit"
              >
                {editMutation.isPending ? "Saving…" : "Save catalog changes"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-5 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            You can join or invite to an open channel, but only its channel
            owners/admins or a community owner/admin may edit its catalog.
          </p>
        )}

        {canInvite ? (
          <form
            className="mt-8 border-t border-border pt-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (invitee) inviteMutation.mutate();
            }}
          >
            <h3 className="text-sm font-semibold">Invite a team member</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                className="h-10 min-w-52 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
                onChange={(event) => setInvitee(event.target.value)}
                value={invitee}
              >
                <option value="">Choose a member</option>
                {communityMembers
                  .filter(
                    (member) =>
                      !members.some(
                        (current) => current.pubkey === member.pubkey,
                      ),
                  )
                  .map((member) => (
                    <option key={member.pubkey} value={member.pubkey}>
                      {profileName(member.pubkey)}
                    </option>
                  ))}
              </select>
              {canManage ? (
                <select
                  className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                  onChange={(event) =>
                    setInviteRole(
                      event.target.value as (typeof MEMBER_ROLES)[number],
                    )
                  }
                  value={inviteRole}
                >
                  {MEMBER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                disabled={!invitee || inviteMutation.isPending}
                type="submit"
              >
                Invite
              </Button>
            </div>
          </form>
        ) : null}

        <section className="mt-8 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Members</h3>
          <div className="mt-3 divide-y divide-border rounded-xl border border-border">
            {members.map((member) => (
              <MemberRow
                canManage={canManage}
                key={member.pubkey}
                member={member}
                name={profileName(member.pubkey)}
                onRemove={() => removeMutation.mutate(member.pubkey)}
                onRoleChange={(role) =>
                  roleMutation.mutate({ pubkey: member.pubkey, role })
                }
                viewerPubkey={viewerPubkey}
              />
            ))}
          </div>
        </section>

        {canManage ? (
          <section className="mt-8 flex flex-wrap justify-between gap-3 border-t border-border pt-6">
            <Button
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (window.confirm(`Archive #${channel.name}?`))
                  archiveMutation.mutate();
              }}
              type="button"
              variant="outline"
            >
              Archive channel
            </Button>
            {canDelete ? (
              <Button
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm(`Permanently delete #${channel.name}?`))
                    deleteMutation.mutate();
                }}
                type="button"
                variant="destructive"
              >
                Delete channel
              </Button>
            ) : null}
          </section>
        ) : null}
        {error instanceof Error ? (
          <p className="mt-4 text-sm text-destructive">{error.message}</p>
        ) : null}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  name,
  canManage,
  viewerPubkey,
  onRoleChange,
  onRemove,
}: {
  member: WorkspaceChannelMember;
  name: string;
  canManage: boolean;
  viewerPubkey: string;
  onRoleChange: (role: (typeof MEMBER_ROLES)[number]) => void;
  onRemove: () => void;
}) {
  const canRemove = canManage || member.pubkey === viewerPubkey.toLowerCase();
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {canManage && member.role !== "owner" ? (
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
          onChange={(event) =>
            onRoleChange(event.target.value as (typeof MEMBER_ROLES)[number])
          }
          value={member.role}
        >
          {MEMBER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs capitalize text-muted-foreground">
          {member.role}
        </span>
      )}
      {canRemove ? (
        <Button onClick={onRemove} size="sm" type="button" variant="ghost">
          Remove
        </Button>
      ) : null}
    </div>
  );
}

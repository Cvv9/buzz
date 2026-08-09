import { X } from "lucide-react";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type {
  WorkspaceChannel,
  WorkspaceCommunityMember,
  WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import type { TimelineMessage } from "../workspace-messages";

type WorkspaceContentDialogsProps = {
  activeChannel: WorkspaceChannel | null;
  addingDmMembers: boolean;
  addDmMemberError: string | null;
  addDmMemberPending: boolean;
  channelAbout: string;
  channelCatalogSection: string;
  channelName: string;
  channelVisibility: "public" | "private";
  communityMembers: WorkspaceCommunityMember[];
  createChannelOpen: boolean;
  creatingChannel: boolean;
  dmMemberQuery: string;
  editingMessage: TimelineMessage | null;
  recipientProfiles: Map<string, WorkspaceProfile> | undefined;
  onAddDmMember: (channelId: string, pubkey: string) => void;
  onCloseAddDmMembers: () => void;
  onCloseCreateChannel: () => void;
  onCloseEditMessage: () => void;
  onCreateChannel: () => void;
  onSaveEditMessage: (message: TimelineMessage, content: string) => void;
  onSetChannelAbout: (value: string) => void;
  onSetChannelCatalogSection: (value: string) => void;
  onSetChannelName: (value: string) => void;
  onSetChannelVisibility: (value: "public" | "private") => void;
  onSetDmMemberQuery: (value: string) => void;
};

/** Create-channel, direct-message membership, and edit-message overlays. */
export function WorkspaceContentDialogs({
  activeChannel,
  addingDmMembers,
  addDmMemberError,
  addDmMemberPending,
  channelAbout,
  channelCatalogSection,
  channelName,
  channelVisibility,
  communityMembers,
  createChannelOpen,
  creatingChannel,
  dmMemberQuery,
  editingMessage,
  recipientProfiles,
  onAddDmMember,
  onCloseAddDmMembers,
  onCloseCreateChannel,
  onCloseEditMessage,
  onCreateChannel,
  onSaveEditMessage,
  onSetChannelAbout,
  onSetChannelCatalogSection,
  onSetChannelName,
  onSetChannelVisibility,
  onSetDmMemberQuery,
}: WorkspaceContentDialogsProps) {
  return (
    <>
      {createChannelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            className="w-full max-w-md rounded-2xl bg-[#fafbf6] p-6 shadow-xl dark:bg-[#20231e]"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateChannel();
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-black/40 dark:text-white/35">
                  VarVik Studios
                </p>
                <h2 className="mt-1 text-xl font-semibold">Create a channel</h2>
              </div>
              <button
                aria-label="Close"
                className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
                type="button"
                onClick={onCloseCreateChannel}
              >
                <X className="size-4" />
              </button>
            </div>
            <label
              className="mb-2 mt-6 block text-sm font-medium"
              htmlFor="new-channel-name"
            >
              Name
            </label>
            <Input
              autoFocus
              id="new-channel-name"
              placeholder="project-launch"
              value={channelName}
              onChange={(event) => onSetChannelName(event.target.value)}
            />
            <label
              className="mb-2 mt-4 block text-sm font-medium"
              htmlFor="new-channel-section"
            >
              Catalog section
            </label>
            <Input
              id="new-channel-section"
              maxLength={80}
              placeholder="e.g. Command Center"
              value={channelCatalogSection}
              onChange={(event) =>
                onSetChannelCatalogSection(event.target.value)
              }
            />
            <label
              className="mb-2 mt-4 block text-sm font-medium"
              htmlFor="new-channel-visibility"
            >
              Visibility
            </label>
            <select
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              id="new-channel-visibility"
              value={channelVisibility}
              onChange={(event) =>
                onSetChannelVisibility(
                  event.target.value as "public" | "private",
                )
              }
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
            <label
              className="mb-2 mt-4 block text-sm font-medium"
              htmlFor="new-channel-description"
            >
              Description
            </label>
            <Input
              id="new-channel-description"
              placeholder="What belongs in this channel?"
              value={channelAbout}
              onChange={(event) => onSetChannelAbout(event.target.value)}
            />
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCloseCreateChannel}
              >
                Cancel
              </Button>
              <Button
                className="bg-[#d7d72e] text-[#171912] hover:bg-[#e5e54d]"
                disabled={!channelName.trim() || creatingChannel}
                type="submit"
              >
                Create channel
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {addingDmMembers && activeChannel?.type === "dm" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            className="w-full max-w-md rounded-2xl bg-[#fafbf6] p-6 shadow-xl dark:bg-[#20231e]"
            onSubmit={(event) => {
              event.preventDefault();
              if (dmMemberQuery) onAddDmMember(activeChannel.id, dmMemberQuery);
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-black/40 dark:text-white/35">
                  Direct message
                </p>
                <h2 className="mt-1 text-xl font-semibold">Add people</h2>
              </div>
              <button
                aria-label="Close"
                className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
                type="button"
                onClick={onCloseAddDmMembers}
              >
                <X className="size-4" />
              </button>
            </div>
            <label
              className="mb-2 mt-6 block text-sm font-medium"
              htmlFor="add-dm-member"
            >
              Person or agent
            </label>
            <select
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              id="add-dm-member"
              value={dmMemberQuery}
              onChange={(event) => onSetDmMemberQuery(event.target.value)}
            >
              <option value="">Choose a member</option>
              {communityMembers
                .filter(
                  (member) =>
                    !activeChannel.memberPubkeys.some(
                      (pubkey) =>
                        pubkey.toLowerCase() === member.pubkey.toLowerCase(),
                    ),
                )
                .map((member) => (
                  <option key={member.pubkey} value={member.pubkey}>
                    {recipientProfiles?.get(member.pubkey)?.name ??
                      truncatePubkey(member.pubkey)}
                  </option>
                ))}
            </select>
            {addDmMemberError ? (
              <p className="mt-3 text-sm text-destructive">
                {addDmMemberError}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCloseAddDmMembers}
              >
                Cancel
              </Button>
              <Button
                disabled={!dmMemberQuery || addDmMemberPending}
                type="submit"
              >
                {addDmMemberPending ? "Adding…" : "Add person"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {editingMessage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            className="w-full max-w-lg rounded-2xl bg-[#fafbf6] p-6 shadow-xl dark:bg-[#20231e]"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              onSaveEditMessage(
                editingMessage,
                String(data.get("content") ?? ""),
              );
            }}
          >
            <h2 className="text-lg font-semibold">Edit message</h2>
            <textarea
              className="mt-4 min-h-32 w-full rounded-xl border border-black/12 bg-transparent p-3 text-sm outline-none focus:border-[#b6b71e] dark:border-white/12"
              defaultValue={editingMessage.content}
              name="content"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCloseEditMessage}
              >
                Cancel
              </Button>
              <Button
                className="bg-[#d7d72e] text-[#171912] hover:bg-[#e5e54d]"
                type="submit"
              >
                Save
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

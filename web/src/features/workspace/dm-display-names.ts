import * as React from "react";
import type { WorkspaceChannel, WorkspaceProfile } from "./workspace-api";

/**
 * The relay names every direct message literally "DM" (or "Group DM (n)").
 * Derive the other participants' names for display, the way Slack labels a
 * conversation. Falls back to the relay name until profiles have loaded.
 */
export function useDmChannelRenamer({
  viewerPubkey,
  agents,
  profiles,
}: {
  viewerPubkey: string | undefined;
  agents: readonly WorkspaceProfile[] | undefined;
  profiles: Map<string, WorkspaceProfile> | undefined;
}) {
  return React.useCallback(
    <T extends WorkspaceChannel>(channel: T): T => {
      if (channel.type !== "dm" || !viewerPubkey) return channel;
      const counterpartNames = channel.memberPubkeys
        .filter((pubkey) => pubkey.toLowerCase() !== viewerPubkey.toLowerCase())
        .map(
          (pubkey) =>
            agents?.find(
              (agent) => agent.pubkey.toLowerCase() === pubkey.toLowerCase(),
            )?.name ??
            (profiles?.get(pubkey) ?? profiles?.get(pubkey.toLowerCase()))
              ?.name,
        )
        .filter((name): name is string => Boolean(name));
      if (!counterpartNames.length) return channel;
      return { ...channel, name: counterpartNames.join(", ") };
    },
    [agents, profiles, viewerPubkey],
  );
}

/**
 * Find an existing direct message whose member set matches exactly the given
 * participants (viewer included), so conversations are reused instead of
 * recreated.
 */
export function findDirectMessageChannel<T extends WorkspaceChannel>(
  channels: readonly T[],
  participantPubkeys: readonly string[],
): T | undefined {
  const participantSet = new Set(
    participantPubkeys.map((pubkey) => pubkey.toLowerCase()),
  );
  return channels.find((channel) => {
    if (channel.type !== "dm") return false;
    const members = new Set(
      channel.memberPubkeys.map((pubkey) => pubkey.toLowerCase()),
    );
    return (
      members.size === participantSet.size &&
      [...participantSet].every((pubkey) => members.has(pubkey))
    );
  });
}

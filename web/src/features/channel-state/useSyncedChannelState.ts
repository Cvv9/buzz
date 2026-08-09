import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  flushChannelMuteOutbox,
  flushChannelStarOutbox,
  publishChannelMutes,
  publishChannelStars,
  readLocalChannelMutes,
  readLocalChannelStars,
  readRemoteChannelMutes,
  readRemoteChannelStars,
  subscribeToChannelMutes,
  subscribeToChannelStars,
  writeLocalChannelMutes,
  writeLocalChannelStars,
} from "./channel-state-api";
import {
  mergeChannelMuteStores,
  mergeChannelStarStores,
} from "./channel-state-policy";

/**
 * Community/identity-scoped channel flags used by the workspace shell.
 * Mutations optimistically persist local intent, then the API's durable outbox
 * merges it with the relay head before publishing the exact NIP-78 coordinate.
 */
export function useSyncedChannelState(pubkey: string | undefined) {
  const queryClient = useQueryClient();
  const mutesQuery = useQuery({
    queryKey: ["channel-mutes", pubkey],
    enabled: Boolean(pubkey),
    queryFn: async () => {
      if (!pubkey) return null;
      const merged = mergeChannelMuteStores(
        readLocalChannelMutes(pubkey),
        await readRemoteChannelMutes(pubkey),
      );
      writeLocalChannelMutes(pubkey, merged);
      return merged;
    },
  });
  const starsQuery = useQuery({
    queryKey: ["channel-stars", pubkey],
    enabled: Boolean(pubkey),
    queryFn: async () => {
      if (!pubkey) return null;
      const merged = mergeChannelStarStores(
        readLocalChannelStars(pubkey),
        await readRemoteChannelStars(pubkey),
      );
      writeLocalChannelStars(pubkey, merged);
      return merged;
    },
  });
  React.useEffect(() => {
    if (!pubkey) return;
    void flushChannelMuteOutbox(pubkey).catch(() => {});
    void flushChannelStarOutbox(pubkey).catch(() => {});
    const stopMutes = subscribeToChannelMutes(pubkey, (remote) => {
      const merged = mergeChannelMuteStores(
        readLocalChannelMutes(pubkey),
        remote,
      );
      writeLocalChannelMutes(pubkey, merged);
      queryClient.setQueryData(["channel-mutes", pubkey], merged);
    });
    const stopStars = subscribeToChannelStars(pubkey, (remote) => {
      const merged = mergeChannelStarStores(
        readLocalChannelStars(pubkey),
        remote,
      );
      writeLocalChannelStars(pubkey, merged);
      queryClient.setQueryData(["channel-stars", pubkey], merged);
    });
    return () => {
      stopMutes();
      stopStars();
    };
  }, [pubkey, queryClient]);
  const toggleMute = React.useCallback(
    (channelId: string) => {
      if (!pubkey || !channelId) return;
      const current = mutesQuery.data ?? readLocalChannelMutes(pubkey);
      const next = {
        ...current,
        channels: {
          ...current.channels,
          [channelId]: {
            muted: !current.channels[channelId]?.muted,
            updatedAt: Date.now(),
          },
        },
      };
      writeLocalChannelMutes(pubkey, next);
      queryClient.setQueryData(["channel-mutes", pubkey], next);
      void publishChannelMutes(pubkey, next).catch(() => {});
    },
    [mutesQuery.data, pubkey, queryClient],
  );
  const toggleStar = React.useCallback(
    (channelId: string) => {
      if (!pubkey || !channelId) return;
      const current = starsQuery.data ?? readLocalChannelStars(pubkey);
      const next = {
        ...current,
        channels: {
          ...current.channels,
          [channelId]: {
            starred: !current.channels[channelId]?.starred,
            updatedAt: Date.now(),
          },
        },
      };
      writeLocalChannelStars(pubkey, next);
      queryClient.setQueryData(["channel-stars", pubkey], next);
      void publishChannelStars(pubkey, next).catch(() => {});
    },
    [pubkey, queryClient, starsQuery.data],
  );
  return {
    mutedChannelIds: new Set(
      Object.entries(mutesQuery.data?.channels ?? {})
        .filter(([, value]) => value.muted)
        .map(([channelId]) => channelId),
    ),
    starredChannelIds: new Set(
      Object.entries(starsQuery.data?.channels ?? {})
        .filter(([, value]) => value.starred)
        .map(([channelId]) => channelId),
    ),
    toggleMute,
    toggleStar,
  };
}

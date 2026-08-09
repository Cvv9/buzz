import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  type ProfileDetail,
  fetchProfileDetail,
  newestEvent,
  profileFromEvent,
  subscribeToProfileDetail,
  userStatusFromEvent,
} from "./profile-api";

export function profileDetailQueryKey(pubkey: string) {
  return ["profile-detail", pubkey.toLowerCase()] as const;
}

export function useProfileDetail(pubkey: string) {
  const queryClient = useQueryClient();
  const normalizedPubkey = pubkey.toLowerCase();
  const query = useQuery({
    queryKey: profileDetailQueryKey(normalizedPubkey),
    queryFn: () => fetchProfileDetail(normalizedPubkey),
    enabled: /^[0-9a-f]{64}$/.test(normalizedPubkey),
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(normalizedPubkey)) return;
    return subscribeToProfileDetail(
      normalizedPubkey,
      (event) => {
        queryClient.setQueryData<ProfileDetail>(
          profileDetailQueryKey(normalizedPubkey),
          (current) => {
            if (
              current?.profileEvent &&
              newestEvent([current.profileEvent, event]) !== event
            ) {
              return current;
            }
            return {
              profile: profileFromEvent(event, normalizedPubkey),
              status: current?.status ?? null,
              profileEvent: event,
              statusEvent: current?.statusEvent,
            };
          },
        );
        // Historical timeline consumers own their cache projection. Refetching
        // their profile list keeps a desktop or another browser's kind 0 edit
        // visible without assuming a local message state shape here.
        void queryClient.invalidateQueries({
          queryKey: ["workspace-profiles"],
        });
      },
      (event) => {
        queryClient.setQueryData<ProfileDetail>(
          profileDetailQueryKey(normalizedPubkey),
          (current) => {
            if (
              current?.statusEvent &&
              newestEvent([current.statusEvent, event]) !== event
            ) {
              return current;
            }
            return {
              profile:
                current?.profile ??
                profileFromEvent(undefined, normalizedPubkey),
              status: userStatusFromEvent(event),
              profileEvent: current?.profileEvent,
              statusEvent: event,
            };
          },
        );
        void queryClient.invalidateQueries({ queryKey: ["user-status"] });
      },
    );
  }, [normalizedPubkey, queryClient]);

  return query;
}

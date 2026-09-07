import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  subscribeToProfiles,
  subscribeToUserStatuses,
} from "@/features/profiles/profile-api";

/** Coalesce initial roster heads and live bursts without sharing stale query promises. */
export function useWorkspaceProfileSync(pubkeyKey: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!pubkeyKey) return;
    const pubkeys = pubkeyKey.split(",");
    const dirty = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = (key: string) => {
      dirty.add(key);
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        for (const target of dirty) {
          void queryClient.invalidateQueries({ queryKey: [target] });
        }
        dirty.clear();
      }, 100);
    };
    const stopProfiles = subscribeToProfiles(pubkeys, () =>
      invalidate("workspace-profiles"),
    );
    const stopStatuses = subscribeToUserStatuses(pubkeys, () =>
      invalidate("user-status"),
    );
    return () => {
      clearTimeout(timer);
      stopProfiles();
      stopStatuses();
    };
  }, [pubkeyKey, queryClient]);
}

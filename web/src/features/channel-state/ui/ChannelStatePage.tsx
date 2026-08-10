import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { BrowserSettingsBreadcrumb } from "@/features/settings/ui/BrowserSettingsBreadcrumb";
import { listWorkspaceChannels } from "@/features/workspace/workspace-api";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { Button } from "@/shared/ui/button";
import {
  publishChannelMutes,
  publishChannelStars,
  readLocalChannelStars,
  readRemoteChannelStars,
  flushChannelMuteOutbox,
  flushChannelStarOutbox,
  subscribeToChannelStars,
  writeLocalChannelStars,
  readLocalChannelDrafts,
  readLocalChannelMutes,
  readRemoteChannelMutes,
  subscribeToChannelMutes,
  writeLocalChannelDrafts,
  writeLocalChannelMutes,
} from "../channel-state-api";
import {
  draftContextId,
  mergeChannelMuteStores,
  mergeChannelStarStores,
  type ChannelDraftStore,
  type ChannelMuteStore,
  type ChannelStarStore,
} from "../channel-state-policy";

function useChannelMutes(pubkey: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["channel-mutes", pubkey],
    queryFn: async () => {
      if (!pubkey) return null;
      const merged = mergeChannelMuteStores(
        readLocalChannelMutes(pubkey),
        await readRemoteChannelMutes(pubkey),
      );
      writeLocalChannelMutes(pubkey, merged);
      return merged;
    },
    enabled: Boolean(pubkey),
  });
  React.useEffect(() => {
    if (!pubkey) return;
    return subscribeToChannelMutes(pubkey, (remote) => {
      const merged = mergeChannelMuteStores(
        readLocalChannelMutes(pubkey),
        remote,
      );
      writeLocalChannelMutes(pubkey, merged);
      queryClient.setQueryData(["channel-mutes", pubkey], merged);
    });
  }, [pubkey, queryClient]);
  return query;
}

function useChannelStars(pubkey: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["channel-stars", pubkey],
    queryFn: async () => {
      if (!pubkey) return null;
      const merged = mergeChannelStarStores(
        readLocalChannelStars(pubkey),
        await readRemoteChannelStars(pubkey),
      );
      writeLocalChannelStars(pubkey, merged);
      return merged;
    },
    enabled: Boolean(pubkey),
  });
  React.useEffect(() => {
    if (!pubkey) return;
    return subscribeToChannelStars(pubkey, (remote) => {
      const merged = mergeChannelStarStores(
        readLocalChannelStars(pubkey),
        remote,
      );
      writeLocalChannelStars(pubkey, merged);
      queryClient.setQueryData(["channel-stars", pubkey], merged);
    });
  }, [pubkey, queryClient]);
  return query;
}

export function ChannelStatePage() {
  const { identity, identityLoading } = useWorkspaceIdentity();
  const search = useSearch({ from: "/channel-state" });
  const [channelId, setChannelId] = React.useState(search.channel ?? "");
  const [threadId, setThreadId] = React.useState(search.thread ?? "");
  const [draft, setDraft] = React.useState("");
  const mutesQuery = useChannelMutes(identity?.pubkey);
  const starsQuery = useChannelStars(identity?.pubkey);
  const channelsQuery = useQuery({
    queryKey: ["workspace-channels", identity?.pubkey],
    queryFn: () => listWorkspaceChannels(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    staleTime: 30_000,
  });
  const drafts = identity ? readLocalChannelDrafts(identity.pubkey) : null;
  const [draftStore, setDraftStore] = React.useState<ChannelDraftStore>(
    drafts ?? { version: 1, drafts: {} },
  );
  React.useEffect(() => {
    if (identity) setDraftStore(readLocalChannelDrafts(identity.pubkey));
  }, [identity]);
  React.useEffect(() => {
    if (!identity) return;
    void flushChannelMuteOutbox(identity.pubkey).catch(() => {
      // The persisted outbox retries on the next mount if the relay is still unavailable.
    });
    void flushChannelStarOutbox(identity.pubkey).catch(() => {
      // The persisted outbox retries on the next mount if the relay is still unavailable.
    });
  }, [identity]);
  const muteMutation = useMutation({
    mutationFn: async (next: ChannelMuteStore) => {
      if (!identity)
        throw new Error("Unlock an identity before changing channel state.");
      writeLocalChannelMutes(identity.pubkey, next);
      await publishChannelMutes(identity.pubkey, next);
      return next;
    },
  });
  const starMutation = useMutation({
    mutationFn: async (next: ChannelStarStore) => {
      if (!identity)
        throw new Error("Unlock an identity before changing channel state.");
      writeLocalChannelStars(identity.pubkey, next);
      await publishChannelStars(identity.pubkey, next);
      return next;
    },
  });
  const context = (() => {
    try {
      return channelId.trim() ? draftContextId(channelId, threadId) : null;
    } catch {
      return null;
    }
  })();
  const saveDraft = () => {
    if (!identity || !context) return;
    const next = { ...draftStore, drafts: { ...draftStore.drafts } };
    if (draft.trim())
      next.drafts[context] = { content: draft, updatedAt: Date.now() };
    else delete next.drafts[context];
    writeLocalChannelDrafts(identity.pubkey, next);
    setDraftStore(next);
  };
  const muted = context
    ? Boolean(mutesQuery.data?.channels[channelId.trim()]?.muted)
    : false;
  const starred = context
    ? Boolean(starsQuery.data?.channels[channelId.trim()]?.starred)
    : false;
  const toggleMuted = () => {
    if (!identity || !channelId.trim()) return;
    const current = mutesQuery.data ?? readLocalChannelMutes(identity.pubkey);
    const next = {
      ...current,
      channels: {
        ...current.channels,
        [channelId.trim()]: { muted: !muted, updatedAt: Date.now() },
      },
    };
    muteMutation.mutate(next);
  };
  const toggleStarred = () => {
    if (!identity || !channelId.trim()) return;
    const current = starsQuery.data ?? readLocalChannelStars(identity.pubkey);
    starMutation.mutate({
      ...current,
      channels: {
        ...current.channels,
        [channelId.trim()]: { starred: !starred, updatedAt: Date.now() },
      },
    });
  };
  if (identityLoading)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Loading channel state…
      </p>
    );
  if (!identity)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Unlock a browser identity to manage private channel state.
      </p>
    );
  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-7">
      <BrowserSettingsBreadcrumb current="Saved channel state" />
      <h1 className="text-2xl font-semibold">Channel state</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Drafts are local to this browser, relay, identity, channel, and thread.
        Mutes sync through encrypted NIP-78 state.
      </p>
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <label
          className="block text-sm font-medium"
          htmlFor="channel-state-channel"
        >
          Channel id
        </label>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          id="channel-state-channel"
          list="channel-state-catalog"
          placeholder="Choose a channel or paste its identifier"
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
        />
        <datalist id="channel-state-catalog">
          {channelsQuery.data?.map((channel) => (
            <option
              key={channel.id}
              label={`#${channel.name}${channel.catalogSection ? ` · ${channel.catalogSection}` : ""}`}
              value={channel.id}
            />
          ))}
        </datalist>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Start typing a channel name to select it from your catalog. You can
          still paste an exact channel identifier for a shared link.
        </p>
        <label
          className="mt-3 block text-sm font-medium"
          htmlFor="channel-state-thread"
        >
          Thread root (optional)
        </label>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          id="channel-state-thread"
          value={threadId}
          onChange={(event) => setThreadId(event.target.value)}
        />
        <label
          className="mt-3 block text-sm font-medium"
          htmlFor="channel-state-draft"
        >
          Draft
        </label>
        <textarea
          className="mt-1 min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm"
          id="channel-state-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!context} type="button" onClick={saveDraft}>
            Save local draft
          </Button>
          <Button
            disabled={!channelId.trim() || muteMutation.isPending}
            type="button"
            variant="outline"
            onClick={toggleMuted}
          >
            {muted ? "Unmute channel" : "Mute channel"}
          </Button>
          <Button
            disabled={!channelId.trim() || starMutation.isPending}
            type="button"
            variant="outline"
            onClick={toggleStarred}
          >
            {starred ? "Unstar channel" : "Star channel"}
          </Button>
        </div>
        {muteMutation.isError ? (
          <p className="mt-3 text-sm text-destructive">
            {muteMutation.error.message}
          </p>
        ) : null}
      </section>
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Saved drafts</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {Object.entries(draftStore.drafts)
            .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
            .map(([key, value]) => (
              <li className="rounded-md bg-muted p-2" key={key}>
                <span className="font-medium text-foreground">{key}</span>
                <br />
                {value.content.slice(0, 180) || "(empty)"}
              </li>
            ))}
          {!Object.keys(draftStore.drafts).length ? (
            <li>No local drafts.</li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}

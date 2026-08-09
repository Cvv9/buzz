import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import {
  archiveSubscriptionKinds,
  archiveChannelEvents,
  clearOfflineArchive,
  exportOfflineArchive,
  importOfflineArchive,
  listArchivedChannelEvents,
  offlineArchiveUsage,
} from "@/features/offline/offline-archive-store";
import {
  supportsOfflineArchive,
  type OfflineArchiveCursor,
} from "@/features/offline/offline-archive-policy";
import { listWorkspaceChannels } from "@/features/workspace/workspace-api";
import {
  type NostrEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";

const PAGE_SIZE = 50;

function partition(pubkey: string) {
  return { relayUrl: relayWsUrl(), pubkey };
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function downloadArchive(serialized: string) {
  const blob = new Blob([serialized], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "buzz-offline-archive.encrypted.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function OfflineArchivePage() {
  const queryClient = useQueryClient();
  const { identity, identityLoading } = useWorkspaceIdentity();
  const [cursor, setCursor] = React.useState<
    OfflineArchiveCursor | undefined
  >();
  const [recording, setRecording] = React.useState(false);
  const [backupPassphrase, setBackupPassphrase] = React.useState("");
  const [importText, setImportText] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const canUseArchive = supportsOfflineArchive() && Boolean(identity);
  const currentPartition = React.useMemo(
    () => (identity ? partition(identity.pubkey) : null),
    [identity],
  );
  const channelsQuery = useQuery({
    queryKey: ["offline-archive-channels", identity?.pubkey],
    queryFn: () => listWorkspaceChannels(identity?.pubkey ?? ""),
    enabled: canUseArchive,
  });
  const archiveQuery = useQuery({
    queryKey: ["offline-archive-page", identity?.pubkey, cursor],
    queryFn: () => {
      if (!currentPartition)
        throw new Error("Unlock a browser identity first.");
      return listArchivedChannelEvents(currentPartition, cursor, PAGE_SIZE);
    },
    enabled: Boolean(currentPartition),
  });
  const usageQuery = useQuery({
    queryKey: ["offline-archive-usage", identity?.pubkey],
    queryFn: () => {
      if (!currentPartition)
        throw new Error("Unlock a browser identity first.");
      return offlineArchiveUsage(currentPartition);
    },
    enabled: Boolean(currentPartition),
  });
  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["offline-archive-page", identity?.pubkey],
    });
    void queryClient.invalidateQueries({
      queryKey: ["offline-archive-usage", identity?.pubkey],
    });
  }, [identity?.pubkey, queryClient]);

  React.useEffect(() => {
    if (identity) return;
    setCursor(undefined);
    setRecording(false);
    queryClient.removeQueries({ queryKey: ["offline-archive-channels"] });
    queryClient.removeQueries({ queryKey: ["offline-archive-page"] });
    queryClient.removeQueries({ queryKey: ["offline-archive-usage"] });
  }, [identity, queryClient]);
  React.useEffect(() => {
    if (!recording || !currentPartition || !channelsQuery.data?.length) return;
    let stopped = false;
    const unsubscribe = channelsQuery.data.map((channel) =>
      subscribeEvents(
        relayWsUrl(),
        { kinds: archiveSubscriptionKinds(), "#h": [channel.id] },
        (event) => {
          if (stopped) return;
          void archiveChannelEvents(currentPartition, [event])
            .then(refresh)
            .catch(() => {});
        },
      ),
    );
    return () => {
      stopped = true;
      for (const stop of unsubscribe) stop();
    };
  }, [channelsQuery.data, currentPartition, recording, refresh]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!currentPartition)
        throw new Error("Unlock a browser identity first.");
      const events = await Promise.all(
        (channelsQuery.data ?? []).map((channel) =>
          queryEvents(relayWsUrl(), {
            kinds: archiveSubscriptionKinds(),
            "#h": [channel.id],
            limit: 100,
          }),
        ),
      );
      const result = await archiveChannelEvents(
        currentPartition,
        events.flat() as NostrEvent[],
      );
      refresh();
      return result;
    },
    onError: (syncError) =>
      setError(
        syncError instanceof Error ? syncError.message : "Offline sync failed.",
      ),
  });
  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!currentPartition)
        throw new Error("Unlock a browser identity first.");
      await clearOfflineArchive(currentPartition);
      setCursor(undefined);
      refresh();
    },
    onError: (clearError) =>
      setError(
        clearError instanceof Error
          ? clearError.message
          : "Could not clear the archive.",
      ),
  });

  if (identityLoading)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Loading offline archive…
      </p>
    );
  if (!supportsOfflineArchive()) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        This browser does not support the IndexedDB and WebCrypto APIs required
        for a local archive.
      </p>
    );
  }
  if (!identity || !currentPartition) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Unlock a browser identity before reading or creating an encrypted
        offline archive.
      </p>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-5 sm:p-8">
      <header>
        <p className="text-sm text-muted-foreground">
          Encrypted on this browser
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Offline channel archive</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Only ordinary channel events delivered through explicit <code>h</code>
          -scoped reads are stored. Private relay events and decrypted agent
          telemetry are excluded.
        </p>
      </header>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Current relay partition</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {usageQuery.data?.count ?? 0} events ·{" "}
              {formatBytes(usageQuery.data?.bytes ?? 0)}
            </p>
          </div>
          <Button
            disabled={syncMutation.isPending || channelsQuery.isPending}
            type="button"
            onClick={() => {
              setError(null);
              syncMutation.mutate();
            }}
          >
            {syncMutation.isPending
              ? "Syncing…"
              : "Archive latest channel events"}
          </Button>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input
            checked={recording}
            type="checkbox"
            onChange={(event) => setRecording(event.target.checked)}
          />
          Record newly delivered channel events while this page remains open
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          No service worker or background archive process is installed.
        </p>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Encrypted archive backup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Exports are encrypted with a new passphrase; the browser identity key
          is never exported.
        </p>
        <label
          className="mt-4 block text-sm"
          htmlFor="offline-backup-passphrase"
        >
          Backup passphrase
          <input
            autoComplete="new-password"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3"
            id="offline-backup-passphrase"
            type="password"
            value={backupPassphrase}
            onChange={(event) => setBackupPassphrase(event.target.value)}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            disabled={backupPassphrase.length < 12}
            type="button"
            variant="outline"
            onClick={() => {
              setError(null);
              void exportOfflineArchive(currentPartition, backupPassphrase)
                .then(downloadArchive)
                .catch((backupError) =>
                  setError(
                    backupError instanceof Error
                      ? backupError.message
                      : "Archive export failed.",
                  ),
                );
            }}
          >
            Download encrypted backup
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input px-3 text-sm hover:bg-accent">
            Select encrypted backup
            <input
              accept="application/json,.json"
              className="sr-only"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file
                  .text()
                  .then(setImportText)
                  .catch(() =>
                    setError("Could not read the selected backup file."),
                  );
                event.target.value = "";
              }}
            />
          </label>
          <Button
            disabled={!importText || backupPassphrase.length < 12}
            type="button"
            variant="outline"
            onClick={() => {
              if (!importText) return;
              setError(null);
              void importOfflineArchive(
                currentPartition,
                backupPassphrase,
                importText,
              )
                .then(() => {
                  setImportText(null);
                  refresh();
                })
                .catch((importError) =>
                  setError(
                    importError instanceof Error
                      ? importError.message
                      : "Archive import failed.",
                  ),
                );
            }}
          >
            Import selected backup
          </Button>
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Archived channel events</h2>
          <Button
            disabled={
              clearMutation.isPending || (usageQuery.data?.count ?? 0) === 0
            }
            type="button"
            variant="destructive"
            onClick={() => {
              if (
                window.confirm(
                  "Delete this relay and identity's local offline archive?",
                )
              ) {
                clearMutation.mutate();
              }
            }}
          >
            Clear local archive
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {archiveQuery.data?.events.map((event) => {
            const channel =
              event.tags.find((tag) => tag[0] === "h")?.[1] ?? "unknown";
            return (
              <article
                className="rounded-lg border border-border p-3"
                key={event.id}
              >
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <Link
                    search={{ channel, forum: undefined, thread: undefined }}
                    to="/"
                  >
                    #{channel}
                  </Link>
                  <span>
                    {new Date(event.created_at * 1_000).toLocaleString()}
                  </span>
                  <span>kind {event.kind}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                  {event.content || "(event with no text content)"}
                </p>
              </article>
            );
          })}
          {!archiveQuery.isPending && !archiveQuery.data?.events.length ? (
            <p className="text-sm text-muted-foreground">
              No encrypted channel events are stored in this partition.
            </p>
          ) : null}
        </div>
        {archiveQuery.data?.nextCursor ? (
          <Button
            className="mt-4"
            type="button"
            variant="outline"
            onClick={() =>
              setCursor(archiveQuery.data?.nextCursor ?? undefined)
            }
          >
            Load older archived events
          </Button>
        ) : null}
      </section>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Headphones, Mic, MicOff, RefreshCw } from "lucide-react";
import * as React from "react";
import {
  listChannelHuddles,
  listHuddleGuideline,
  publishHuddleGuideline,
  startBrowserHuddle,
  subscribeToChannelHuddles,
  subscribeToHuddleGuideline,
} from "@/features/huddle/huddle-api";
import {
  BrowserHuddleAudio,
  browserHuddleAudioUnsupportedReason,
  listBrowserAudioInputs,
  type HuddleAudioInput,
  type HuddleAudioState,
} from "@/features/huddle/huddle-audio";
import {
  canJoinHuddle,
  isHuddleChannelId,
  type HuddleSession,
} from "@/features/huddle/huddle-policy";
import {
  listWorkspaceChannels,
  type WorkspaceChannel,
} from "@/features/workspace/workspace-api";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";

function sessionTime(timestamp: number) {
  return new Date(timestamp * 1_000).toLocaleString();
}

function shortPubkey(pubkey: string) {
  return truncatePubkey(pubkey);
}

function isWritableChannel(channel: WorkspaceChannel | undefined) {
  return Boolean(
    channel && ["owner", "admin", "member", "guest"].includes(channel.role),
  );
}

function HuddleAudioControls({
  parentChannelId,
  session,
}: {
  parentChannelId: string;
  session: HuddleSession;
}) {
  const audioRef = React.useRef<BrowserHuddleAudio | null>(null);
  const [state, setState] = React.useState<HuddleAudioState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [inputs, setInputs] = React.useState<HuddleAudioInput[]>([]);
  const [deviceId, setDeviceId] = React.useState("");
  const unsupported = browserHuddleAudioUnsupportedReason();

  const refreshInputs = React.useCallback(() => {
    void listBrowserAudioInputs()
      .then(setInputs)
      .catch(() => setInputs([]));
  }, []);

  React.useEffect(() => {
    refreshInputs();
    return () => {
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) void audio.close();
    };
  }, [refreshInputs]);

  const connect = React.useCallback(async () => {
    if (unsupported) return;
    const previous = audioRef.current;
    audioRef.current = null;
    if (previous) await previous.close();
    setError(null);
    const audio = new BrowserHuddleAudio({
      channelId: session.ephemeralChannelId,
      parentChannelId,
      deviceId: deviceId || undefined,
      onStateChange: (next, nextError) => {
        if (audioRef.current !== audio) return;
        setState(next);
        if (nextError) setError(nextError.message);
      },
    });
    audioRef.current = audio;
    try {
      await audio.connect();
      refreshInputs();
    } catch {
      // State/error is reported from the transport without exposing audio data.
    }
  }, [
    deviceId,
    parentChannelId,
    refreshInputs,
    session.ephemeralChannelId,
    unsupported,
  ]);

  const leave = React.useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    setMuted(false);
    if (audio) void audio.close();
    setState("idle");
  }, []);

  const toggleMute = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.connected) return;
    const nextMuted = !audio.isMuted;
    audio.setMuted(nextMuted);
    setMuted(nextMuted);
  }, []);

  const connecting =
    state === "requesting-permission" || state === "connecting";
  const connected = state === "connected";
  return (
    <div className="mt-4 border-t border-border/70 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {connected ? (
          <>
            <Button
              onClick={toggleMute}
              size="sm"
              type="button"
              variant="secondary"
            >
              {muted ? <MicOff /> : <Mic />}
              {muted ? "Unmute" : "Mute"}
            </Button>
            <Button onClick={leave} size="sm" type="button" variant="outline">
              Leave audio
            </Button>
          </>
        ) : (
          <Button
            disabled={Boolean(unsupported) || connecting}
            onClick={() => void connect()}
            size="sm"
            type="button"
          >
            <Headphones />
            {connecting ? "Joining audio…" : "Join audio"}
          </Button>
        )}
        <label className="ml-auto flex min-w-48 items-center gap-2 text-sm text-muted-foreground">
          Microphone
          <select
            aria-label="Huddle microphone"
            className="h-8 min-w-36 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            disabled={connecting}
            onChange={(event) => setDeviceId(event.target.value)}
            value={deviceId}
          >
            <option value="">System default</option>
            {inputs.map((input) => (
              <option key={input.deviceId} value={input.deviceId}>
                {input.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
      </div>
      {connected && deviceId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Select another microphone, then rejoin audio to apply it.
        </p>
      ) : null}
      {unsupported ? (
        <p className="mt-2 text-sm text-muted-foreground">{unsupported}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      <p aria-live="polite" className="sr-only">
        {connected ? "Huddle audio connected." : "Huddle audio disconnected."}
      </p>
    </div>
  );
}

function HuddleCard({
  canWrite,
  parentChannelId,
  session,
}: {
  canWrite: boolean;
  parentChannelId: string;
  session: HuddleSession;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const guidelineKey = React.useMemo(
    () => ["huddle-guideline", session.ephemeralChannelId],
    [session.ephemeralChannelId],
  );
  const guidelineQuery = useQuery({
    queryKey: guidelineKey,
    queryFn: () => listHuddleGuideline(session.ephemeralChannelId),
    enabled: isHuddleChannelId(session.ephemeralChannelId),
  });
  const active = canJoinHuddle(session);

  React.useEffect(
    () =>
      subscribeToHuddleGuideline(session.ephemeralChannelId, () => {
        void queryClient.invalidateQueries({ queryKey: guidelineKey });
      }),
    [guidelineKey, queryClient, session.ephemeralChannelId],
  );
  React.useEffect(() => {
    setDraft(guidelineQuery.data?.content ?? "");
  }, [guidelineQuery.data?.content]);

  const saveGuideline = async () => {
    setSaving(true);
    try {
      await publishHuddleGuideline(session.ephemeralChannelId, draft);
      await queryClient.invalidateQueries({ queryKey: guidelineKey });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="huddle-session">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Headphones className="size-4" />
              {active ? "Huddle in progress" : "Huddle ended"}
            </CardTitle>
            <CardDescription className="mt-1">
              Started {sessionTime(session.startedAt)} by{" "}
              {shortPubkey(session.startedBy)}
            </CardDescription>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {session.participants.length} participant
            {session.participants.length === 1 ? "" : "s"}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {session.participants.length ? (
          <p className="text-sm text-muted-foreground">
            {session.participants.map(shortPubkey).join(", ")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {session.endedAt
              ? `Ended ${sessionTime(session.endedAt)}.`
              : "No participants have joined yet."}
          </p>
        )}
        <section className="mt-4">
          <h2 className="text-sm font-medium">Guidelines</h2>
          {canWrite ? (
            <>
              <textarea
                aria-label="Huddle guidelines"
                className="mt-2 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                maxLength={8_000}
                onChange={(event) => setDraft(event.target.value)}
                value={draft}
              />
              <Button
                className="mt-2"
                disabled={!draft.trim() || saving}
                onClick={() => void saveGuideline()}
                size="sm"
                type="button"
                variant="outline"
              >
                {saving ? "Saving…" : "Save guidelines"}
              </Button>
            </>
          ) : guidelineQuery.data?.content ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {guidelineQuery.data.content}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No guidelines were published.
            </p>
          )}
        </section>
        {active ? (
          <HuddleAudioControls
            parentChannelId={parentChannelId}
            session={session}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HuddlePage({ channelId }: { channelId: string }) {
  const { identity } = useWorkspaceIdentity();
  const queryClient = useQueryClient();
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const channelsQuery = useQuery({
    queryKey: ["workspace-channels", identity?.pubkey],
    queryFn: () => listWorkspaceChannels(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    retry: false,
  });
  const channel = channelsQuery.data?.find(
    (candidate) => candidate.id === channelId,
  );
  const huddlesKey = React.useMemo(
    () => ["channel-huddles", channelId],
    [channelId],
  );
  const huddlesQuery = useQuery({
    queryKey: huddlesKey,
    queryFn: () => listChannelHuddles(channelId),
    enabled: Boolean(identity && channel),
    retry: false,
  });
  const canWrite = isWritableChannel(channel);

  React.useEffect(() => {
    if (!channel) return;
    let reconnecting = false;
    return subscribeToChannelHuddles(
      channelId,
      () => void queryClient.invalidateQueries({ queryKey: huddlesKey }),
      (status) => {
        if (status === "closed") reconnecting = true;
        if (status === "live" && reconnecting) {
          reconnecting = false;
          void queryClient.invalidateQueries({ queryKey: huddlesKey });
        }
      },
    );
  }, [channel, channelId, huddlesKey, queryClient]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await startBrowserHuddle(channelId);
      await queryClient.invalidateQueries({ queryKey: huddlesKey });
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "Could not start a huddle.",
      );
    } finally {
      setStarting(false);
    }
  };

  if (!identity) {
    return (
      <main className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground sm:p-7">
        Sign in to view huddles.
      </main>
    );
  }
  if (channelsQuery.isLoading) {
    return (
      <main className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground sm:p-7">
        Loading channel access…
      </main>
    );
  }
  if (!channel) {
    return (
      <main className="mx-auto max-w-3xl p-4 text-sm text-destructive sm:p-7">
        This huddle channel is not available to this identity.
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-7">
      <a
        className="text-sm text-primary hover:underline"
        href={`/?channel=${encodeURIComponent(channelId)}`}
      >
        Back to #{channel.name}
      </a>
      <header className="mt-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Huddles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lifecycle history is shared with the channel. Joining audio asks for
            microphone permission separately.
          </p>
        </div>
        <Button
          disabled={!canWrite || !isHuddleChannelId(channelId) || starting}
          onClick={() => void start()}
          type="button"
        >
          <Headphones />
          {starting ? "Starting…" : "Start huddle"}
        </Button>
      </header>
      {!canWrite ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Your channel role cannot start a huddle. Relay authorization remains
          authoritative.
        </p>
      ) : null}
      {!isHuddleChannelId(channelId) ? (
        <p className="mt-3 text-sm text-muted-foreground">
          This development channel does not have a canonical relay UUID, so it
          is read-only for huddle creation.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {huddlesQuery.isError ? (
        <p className="mt-5 text-sm text-destructive">
          {huddlesQuery.error.message}
        </p>
      ) : null}
      <section className="mt-6 space-y-3" aria-label="Huddle history">
        {huddlesQuery.data?.map((session) => (
          <HuddleCard
            canWrite={canWrite}
            key={session.ephemeralChannelId}
            parentChannelId={channelId}
            session={session}
          />
        ))}
        {!huddlesQuery.isLoading && !huddlesQuery.data?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No huddles have started in #{channel.name}.
            </CardContent>
          </Card>
        ) : null}
      </section>
      {huddlesQuery.isFetching ? (
        <RefreshCw
          aria-label="Refreshing huddles"
          className="mt-4 size-4 animate-spin text-muted-foreground"
        />
      ) : null}
    </main>
  );
}

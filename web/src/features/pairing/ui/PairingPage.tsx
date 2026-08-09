import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  BrowserPairingSession,
  type PairingSnapshot,
} from "@/features/pairing/pairing-client";
import { pairingCapabilities } from "@/features/pairing/pairing-policy";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { Button } from "@/shared/ui/button";

const initialSnapshot: PairingSnapshot = {
  stage: "aborted",
  role: "source",
  code: null,
  pairingUri: null,
  error: null,
};

export function PairingPage() {
  const { identity } = useWorkspaceIdentity();
  const sessionRef = React.useRef<BrowserPairingSession | null>(null);
  const [snapshot, setSnapshot] =
    React.useState<PairingSnapshot>(initialSnapshot);
  const [pairingCode, setPairingCode] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const capabilities = pairingCapabilities();

  React.useEffect(
    () => () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    },
    [],
  );

  const useSession = (session: BrowserPairingSession) => {
    sessionRef.current?.dispose();
    sessionRef.current = session;
    session.subscribe(setSnapshot);
  };
  const beginSource = () => {
    setBusy(true);
    void BrowserPairingSession.createSource()
      .then(useSession)
      .catch((error) =>
        setSnapshot({
          ...initialSnapshot,
          role: "source",
          error:
            error instanceof Error ? error.message : "Could not start pairing.",
        }),
      )
      .finally(() => setBusy(false));
  };
  const joinTarget = () => {
    setBusy(true);
    void BrowserPairingSession.joinTarget(pairingCode)
      .then(useSession)
      .catch((error) =>
        setSnapshot({
          ...initialSnapshot,
          role: "target",
          error:
            error instanceof Error ? error.message : "Could not join pairing.",
        }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-5 sm:p-8">
      <header>
        <p className="text-sm text-muted-foreground">
          NIP-AB · short-lived device transfer
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Pair this browser</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Pairing uses fresh ephemeral keys on the relay's advertised pairing
          sidecar. Compare the six-digit code on both physical devices before
          either device transfers or imports an identity.
        </p>
      </header>
      {!capabilities.crypto ? (
        <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          This browser lacks WebCrypto, so NIP-AB pairing is unavailable.
        </p>
      ) : null}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Source device</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use this on the browser that already holds the browser identity.
        </p>
        <Button
          className="mt-4"
          disabled={!identity || busy || !capabilities.crypto}
          type="button"
          onClick={beginSource}
        >
          {busy && snapshot.role === "source"
            ? "Starting…"
            : "Create one-time pairing code"}
        </Button>
        {!identity ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Unlock this browser identity before creating a pairing code.
          </p>
        ) : null}
        {snapshot.role === "source" && snapshot.pairingUri ? (
          <div className="mt-4 space-y-3">
            <label className="block text-sm" htmlFor="pairing-uri">
              One-time pairing code
            </label>
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
              id="pairing-uri"
              readOnly
              value={snapshot.pairingUri}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void navigator.clipboard?.writeText(snapshot.pairingUri ?? "")
              }
            >
              Copy pairing code
            </Button>
            <p className="text-xs text-muted-foreground">
              The code includes a 120-second session secret. Share it only with
              the receiving device.
            </p>
          </div>
        ) : null}
        {snapshot.role === "source" && snapshot.code ? (
          <div className="mt-4 rounded-lg bg-muted p-4">
            <p className="text-sm text-muted-foreground">
              Compare this code with the target device
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.2em]">
              {snapshot.code}
            </p>
            {snapshot.stage === "source-confirm" ? (
              <Button
                className="mt-4"
                type="button"
                onClick={() =>
                  void sessionRef.current
                    ?.confirmSourceAndSendIdentity()
                    .catch((error) =>
                      setSnapshot((current) => ({
                        ...current,
                        error:
                          error instanceof Error
                            ? error.message
                            : "Could not send identity.",
                      })),
                    )
                }
              >
                Codes match — send recovery identity
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Target device</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a pairing code from the source device. Camera/QR rendering is
          not claimed until a compatible scanner is present.
        </p>
        <label className="mt-4 block text-sm" htmlFor="pairing-code">
          Pairing code
        </label>
        <textarea
          className="mt-2 min-h-28 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
          id="pairing-code"
          placeholder="nostrpair://…"
          value={pairingCode}
          onChange={(event) => setPairingCode(event.target.value)}
        />
        <Button
          className="mt-3"
          disabled={busy || !pairingCode.trim() || !capabilities.crypto}
          type="button"
          onClick={joinTarget}
        >
          {busy && snapshot.role === "target" ? "Joining…" : "Join pairing"}
        </Button>
        {snapshot.role === "target" && snapshot.code ? (
          <div className="mt-4 rounded-lg bg-muted p-4">
            <p className="text-sm text-muted-foreground">
              Compare this code with the source device
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.2em]">
              {snapshot.code}
            </p>
            {snapshot.stage === "target-confirm" ? (
              <Button
                className="mt-4"
                type="button"
                onClick={() =>
                  void sessionRef.current?.confirmTargetSas().catch((error) =>
                    setSnapshot((current) => ({
                      ...current,
                      error:
                        error instanceof Error
                          ? error.message
                          : "Could not confirm pairing.",
                    })),
                  )
                }
              >
                Codes match — allow identity receipt
              </Button>
            ) : null}
          </div>
        ) : null}
        {snapshot.stage === "target-ready-import" ? (
          <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
            <h3 className="font-medium">Import verified identity</h3>
            <p className="text-sm text-muted-foreground">
              Choose a new local password. Import happens only when you select
              the button below.
            </p>
            <input
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <input
              autoComplete="new-password"
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="New local password (12+ characters)"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              disabled={password.length < 12}
              type="button"
              onClick={() =>
                void sessionRef.current
                  ?.importReceivedIdentity(displayName, password)
                  .then(() => window.location.assign("/"))
                  .catch((error) =>
                    setSnapshot((current) => ({
                      ...current,
                      error:
                        error instanceof Error
                          ? error.message
                          : "Identity import failed.",
                    })),
                  )
              }
            >
              Import identity to this browser
            </Button>
          </div>
        ) : null}
      </section>
      <section className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        <h2 className="font-semibold text-foreground">Browser limits</h2>
        <p className="mt-2">
          No native keychain, filesystem command, background pairing, or
          system-wide key import is exposed. Pairing secrets are memory-only and
          cleared on completion, cancel, timeout, or route exit.
        </p>
        <Link
          className="mt-3 inline-block text-primary hover:underline"
          to="/preferences"
        >
          Open browser notification and accessibility preferences
        </Link>
      </section>
      {snapshot.error ? (
        <p className="text-sm text-destructive" role="alert">
          {snapshot.error}
        </p>
      ) : null}
      {sessionRef.current &&
      !["completed", "aborted", "expired"].includes(snapshot.stage) ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void sessionRef.current?.cancel()}
        >
          Cancel pairing
        </Button>
      ) : null}
    </main>
  );
}

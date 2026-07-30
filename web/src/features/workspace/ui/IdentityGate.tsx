import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import * as React from "react";
import {
  type BrowserIdentity,
  createBrowserIdentity,
  importBrowserIdentity,
} from "@/shared/lib/browser-identity";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function IdentityGate({
  onReady,
}: {
  onReady: (identity: BrowserIdentity) => void;
}) {
  const [mode, setMode] = React.useState<"create" | "import">("create");
  const [displayName, setDisplayName] = React.useState("");
  const [nsec, setNsec] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) {
      setError("Enter the name teammates should see.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const identity =
        mode === "create"
          ? await createBrowserIdentity(displayName)
          : await importBrowserIdentity(nsec, displayName);
      onReady(identity);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the identity.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] bg-[#111310] text-[#f3f4ec] lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden overflow-hidden border-r border-white/10 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(215,215,46,0.18),transparent_28%),radial-gradient(circle_at_80%_75%,rgba(215,231,246,0.12),transparent_32%)]" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#d7d72e] font-black text-[#111310]">
            V
          </div>
          <div>
            <p className="font-semibold">VarVik Studios</p>
            <p className="text-sm text-white/50">Private team workspace</p>
          </div>
        </div>
        <div className="relative max-w-xl">
          <p className="text-sm font-medium text-[#d7d72e]">
            People and agents, one room
          </p>
          <h1 className="mt-5 text-5xl font-semibold tracking-[-0.045em]">
            Work together without handing your identity to a platform.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-white/60">
            Your browser creates a signing identity for messages, files and
            agent requests. The private key remains on this device.
          </p>
        </div>
        <div className="relative flex gap-6 text-sm text-white/45">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Device-bound key
          </span>
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" /> Signed activity
          </span>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#d7d72e] font-black text-[#111310]">
                V
              </div>
              <div>
                <p className="font-semibold">VarVik Studios</p>
                <p className="text-sm text-white/50">Private team workspace</p>
              </div>
            </div>
          </div>
          <p className="text-sm font-medium text-[#d7d72e]">Browser access</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            {mode === "create"
              ? "Create your identity"
              : "Use an existing identity"}
          </h2>
          <p className="mt-3 leading-7 text-white/55">
            {mode === "create"
              ? "This device will remember you. Back up the private key from settings after joining."
              : "Import the nsec backup from another Buzz installation."}
          </p>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label
              className="mb-2 block text-sm font-medium"
              htmlFor="identity-display-name"
            >
              Display name
            </label>
            <Input
              id="identity-display-name"
              autoComplete="name"
              className="h-12 border-white/15 bg-white/5 text-white placeholder:text-white/30 focus-visible:ring-[#d7d72e]"
              placeholder="Your name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            {mode === "import" ? (
              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  htmlFor="identity-private-key"
                >
                  Private identity key
                </label>
                <Input
                  id="identity-private-key"
                  autoComplete="off"
                  className="h-12 border-white/15 bg-white/5 font-mono text-white placeholder:text-white/30 focus-visible:ring-[#d7d72e]"
                  placeholder="nsec1…"
                  type="password"
                  value={nsec}
                  onChange={(event) => setNsec(event.target.value)}
                />
              </div>
            ) : null}
            {error ? (
              <p
                className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button
              className="h-12 w-full bg-[#d7d72e] text-[#111310] hover:bg-[#e5e54d]"
              disabled={submitting}
              type="submit"
            >
              {submitting ? (
                "Saving identity…"
              ) : (
                <>
                  <LogIn className="mr-2 size-4" />
                  {mode === "create"
                    ? "Continue to VarVik"
                    : "Import and continue"}
                </>
              )}
            </Button>
          </form>

          <button
            className="mt-6 text-sm text-white/55 underline-offset-4 hover:text-white hover:underline"
            type="button"
            onClick={() => {
              setError(null);
              setMode((current) =>
                current === "create" ? "import" : "create",
              );
            }}
          >
            {mode === "create"
              ? "Already have a Buzz identity?"
              : "Create a new identity instead"}
          </button>
        </div>
      </section>
    </div>
  );
}

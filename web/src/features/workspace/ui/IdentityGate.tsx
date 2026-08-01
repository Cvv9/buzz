import { KeyRound, LogIn, ShieldCheck, UserRound } from "lucide-react";
import * as React from "react";
import {
  type BrowserIdentity,
  type StoredBrowserIdentitySummary,
  createBrowserIdentity,
  importBrowserIdentity,
  migrateLegacyBrowserIdentity,
  unlockBrowserIdentity,
} from "@/shared/lib/browser-identity";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

type IdentityMode = "unlock" | "migrate" | "import" | "create";

function initialMode(
  storedIdentity: StoredBrowserIdentitySummary | null,
): IdentityMode {
  if (!storedIdentity) return "import";
  return storedIdentity.protection === "legacy" ? "migrate" : "unlock";
}

function PasswordFields({
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
}: {
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
}) {
  return (
    <>
      <div>
        <label
          className="mb-2 block text-sm font-medium"
          htmlFor="identity-password"
        >
          Password
        </label>
        <Input
          id="identity-password"
          autoComplete="new-password"
          className="h-12 border-white/15 bg-white/5 text-white placeholder:text-white/35 focus-visible:ring-[#d7d72e]"
          placeholder="At least 10 characters"
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </div>
      <div>
        <label
          className="mb-2 block text-sm font-medium"
          htmlFor="identity-password-confirmation"
        >
          Confirm password
        </label>
        <Input
          id="identity-password-confirmation"
          autoComplete="new-password"
          className="h-12 border-white/15 bg-white/5 text-white placeholder:text-white/35 focus-visible:ring-[#d7d72e]"
          placeholder="Enter it again"
          type="password"
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
      </div>
    </>
  );
}

export function IdentityGate({
  storedIdentity,
  pendingInvite,
  onReady,
}: {
  storedIdentity: StoredBrowserIdentitySummary | null;
  pendingInvite: boolean;
  onReady: (identity: BrowserIdentity) => void;
}) {
  const [mode, setMode] = React.useState<IdentityMode>(() =>
    initialMode(storedIdentity),
  );
  const [displayName, setDisplayName] = React.useState("");
  const [nsec, setNsec] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirmation, setPasswordConfirmation] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const needsNewPassword = mode !== "unlock";
  const title =
    mode === "unlock"
      ? `Welcome back, ${storedIdentity?.displayName ?? "team member"}`
      : mode === "migrate"
        ? "Secure your saved account"
        : mode === "create"
          ? "Create your Buzz account"
          : "Sign in to VarVik Studios";
  const description =
    mode === "unlock"
      ? "Enter your password to unlock this account on this device."
      : mode === "migrate"
        ? "Add a password to the Buzz identity already saved in this browser."
        : mode === "create"
          ? "Create a new identity, then use the invitation to join the workspace."
          : "Use your private recovery key once. This browser will store it encrypted with your password.";

  const resetForm = (nextMode: IdentityMode) => {
    setError(null);
    setPassword("");
    setPasswordConfirmation("");
    setNsec("");
    setDisplayName("");
    setMode(nextMode);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((mode === "import" || mode === "create") && !displayName.trim()) {
      setError("Enter the name teammates should see.");
      return;
    }
    if (needsNewPassword && password !== passwordConfirmation) {
      setError("The passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const identity =
        mode === "unlock"
          ? await unlockBrowserIdentity(password)
          : mode === "migrate"
            ? await migrateLegacyBrowserIdentity(password)
            : mode === "create"
              ? await createBrowserIdentity(displayName, password)
              : await importBrowserIdentity(nsec, displayName, password);
      onReady(identity);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not sign in to Buzz.",
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
            Your work. Your identity.
          </p>
          <h1 className="mt-5 text-5xl font-semibold tracking-[-0.045em]">
            One secure account across Buzz.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-white/60">
            Sign in before messages, files, channels, and agents become
            available on this device.
          </p>
        </div>
        <div className="relative flex gap-6 text-sm text-white/45">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Password protected
          </span>
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" /> Device-bound identity
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

          {mode === "unlock" && storedIdentity ? (
            <div className="mb-7 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#d7d72e]/15 text-[#e5e54d]">
                <UserRound className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {storedIdentity.displayName}
                </p>
                <p className="mt-0.5 font-mono text-xs text-white/40">
                  {truncatePubkey(storedIdentity.pubkey)}
                </p>
              </div>
            </div>
          ) : null}

          <p className="text-sm font-medium text-[#d7d72e]">Employee sign in</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-3 leading-7 text-white/55">{description}</p>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            {mode === "import" || mode === "create" ? (
              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  htmlFor="identity-display-name"
                >
                  Display name
                </label>
                <Input
                  id="identity-display-name"
                  autoComplete="name"
                  className="h-12 border-white/15 bg-white/5 text-white placeholder:text-white/35 focus-visible:ring-[#d7d72e]"
                  placeholder="Your name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            ) : null}

            {mode === "import" ? (
              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  htmlFor="identity-private-key"
                >
                  Recovery key
                </label>
                <Input
                  id="identity-private-key"
                  autoComplete="off"
                  className="h-12 border-white/15 bg-white/5 font-mono text-white placeholder:text-white/35 focus-visible:ring-[#d7d72e]"
                  placeholder="nsec1..."
                  type="password"
                  value={nsec}
                  onChange={(event) => setNsec(event.target.value)}
                />
              </div>
            ) : null}

            {mode === "unlock" ? (
              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  htmlFor="identity-password"
                >
                  Password
                </label>
                <Input
                  id="identity-password"
                  autoComplete="current-password"
                  autoFocus
                  className="h-12 border-white/15 bg-white/5 text-white placeholder:text-white/35 focus-visible:ring-[#d7d72e]"
                  placeholder="Your Buzz password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            ) : (
              <PasswordFields
                confirmation={passwordConfirmation}
                password={password}
                onConfirmationChange={setPasswordConfirmation}
                onPasswordChange={setPassword}
              />
            )}

            {mode === "import" && storedIdentity ? (
              <p className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                Signing in with another recovery key replaces the account saved
                on this browser. Back up the current account first.
              </p>
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
              className="h-12 w-full bg-[#d7d72e] text-[#111310] hover:bg-[#e5e54d] active:translate-y-px"
              disabled={submitting}
              type="submit"
            >
              <LogIn className="mr-2 size-4" />
              {submitting
                ? "Signing in..."
                : mode === "unlock"
                  ? "Sign in"
                  : mode === "migrate"
                    ? "Secure and sign in"
                    : mode === "create"
                      ? "Create account"
                      : "Sign in with recovery key"}
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-3 text-sm text-white/55">
            {storedIdentity && mode !== "unlock" ? (
              <button
                className="underline-offset-4 hover:text-white hover:underline"
                type="button"
                onClick={() => resetForm(initialMode(storedIdentity))}
              >
                Return to saved account
              </button>
            ) : null}
            {storedIdentity && mode === "unlock" ? (
              <button
                className="underline-offset-4 hover:text-white hover:underline"
                type="button"
                onClick={() => resetForm("import")}
              >
                Use a different account
              </button>
            ) : null}
            {pendingInvite && mode !== "create" ? (
              <button
                className="underline-offset-4 hover:text-white hover:underline"
                type="button"
                onClick={() => resetForm("create")}
              >
                Create a new account
              </button>
            ) : null}
            {pendingInvite && mode === "create" ? (
              <button
                className="underline-offset-4 hover:text-white hover:underline"
                type="button"
                onClick={() => resetForm("import")}
              >
                Use an existing account
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

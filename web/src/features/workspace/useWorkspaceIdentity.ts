import * as React from "react";
import {
  type BrowserIdentity,
  type StoredBrowserIdentitySummary,
  getStoredBrowserIdentity,
  getUnlockedBrowserIdentity,
  lockBrowserIdentity,
  unlockBrowserIdentityForDevice,
} from "@/shared/lib/browser-identity";

export function useWorkspaceIdentity() {
  const [identity, setIdentity] = React.useState<BrowserIdentity | null>(
    getUnlockedBrowserIdentity,
  );
  const [storedIdentity, setStoredIdentity] =
    React.useState<StoredBrowserIdentitySummary | null>(null);
  const [identityLoading, setIdentityLoading] = React.useState(
    () => !getUnlockedBrowserIdentity(),
  );
  const [identityError, setIdentityError] = React.useState<Error | null>(null);
  const [restoreAttempt, setRestoreAttempt] = React.useState(0);
  const retryIdentity = React.useCallback(() => {
    setIdentityError(null);
    setIdentityLoading(true);
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly restarts the storage read after a recoverable failure.
  React.useEffect(() => {
    let active = true;
    const restoreIdentity = async () => {
      const current = getUnlockedBrowserIdentity();
      if (current) {
        setIdentity(current);
        setStoredIdentity({ ...current, protection: "password" });
        setIdentityLoading(false);
        return;
      }
      const stored = await getStoredBrowserIdentity();
      if (!active) return;
      setStoredIdentity(stored);
      // Failure to auto-unlock must retain the password-unlock screen.
      const restored = stored
        ? await unlockBrowserIdentityForDevice().catch(() => null)
        : null;
      if (!active) return;
      if (restored) setIdentity(restored);
      setIdentityLoading(false);
    };
    void restoreIdentity().catch((cause: unknown) => {
      if (!active) return;
      setIdentityError(
        cause instanceof Error
          ? cause
          : new Error("Could not read your saved account."),
      );
      setIdentityLoading(false);
    });
    const synchronizeLockState = () => {
      if (!active) return;
      const current = getUnlockedBrowserIdentity();
      setIdentity(current);
      if (current) {
        setStoredIdentity({ ...current, protection: "password" });
        setIdentityError(null);
        setIdentityLoading(false);
      }
    };
    window.addEventListener(
      "buzz-browser-identity-changed",
      synchronizeLockState,
    );
    return () => {
      active = false;
      window.removeEventListener(
        "buzz-browser-identity-changed",
        synchronizeLockState,
      );
    };
  }, [restoreAttempt]);

  const lock = React.useCallback(() => {
    lockBrowserIdentity();
    setIdentity(null);
  }, []);

  return {
    identity,
    identityLoading,
    identityError,
    retryIdentity,
    lock,
    setIdentity,
    setStoredIdentity,
    storedIdentity,
  };
}

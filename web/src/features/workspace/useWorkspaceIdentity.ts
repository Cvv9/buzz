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
  const [identity, setIdentity] = React.useState<BrowserIdentity | null>(null);
  const [storedIdentity, setStoredIdentity] =
    React.useState<StoredBrowserIdentitySummary | null>(null);
  const [identityLoading, setIdentityLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    const restoreIdentity = async () => {
      const [stored, restored] = await Promise.all([
        getStoredBrowserIdentity(),
        getUnlockedBrowserIdentity() ?? unlockBrowserIdentityForDevice(),
      ]);
      if (!active) return;
      setStoredIdentity(stored);
      if (restored) setIdentity(restored);
      setIdentityLoading(false);
    };
    void restoreIdentity().catch(() => {
      if (active) setIdentityLoading(false);
    });
    const synchronizeLockState = () => {
      if (!active) return;
      setIdentity(getUnlockedBrowserIdentity());
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
  }, []);

  const lock = React.useCallback(() => {
    lockBrowserIdentity();
    setIdentity(null);
  }, []);

  return {
    identity,
    identityLoading,
    lock,
    setIdentity,
    setStoredIdentity,
    storedIdentity,
  };
}

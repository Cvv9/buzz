import * as React from "react";
import { BrowserSettingsBreadcrumb } from "@/features/settings/ui/BrowserSettingsBreadcrumb";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { Button } from "@/shared/ui/button";
import {
  applyBrowserPreferences,
  browserNotificationPermission,
  previewNotificationSound,
  readBrowserPreferences,
  requestBrowserNotifications,
  writeBrowserPreferences,
  type BrowserPreferences,
} from "../browser-preferences";

export function PreferencesPage() {
  const { identity, identityLoading } = useWorkspaceIdentity();
  const [preferences, setPreferences] =
    React.useState<BrowserPreferences | null>(null);
  const [permission, setPermission] = React.useState<
    NotificationPermission | "unsupported"
  >(browserNotificationPermission);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!identity) {
      setPreferences(null);
      return;
    }
    const next = readBrowserPreferences(identity.pubkey);
    setPreferences(next);
    applyBrowserPreferences(next);
  }, [identity]);
  React.useEffect(() => {
    const refresh = () => setPermission(browserNotificationPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const update = (change: Partial<BrowserPreferences>) => {
    if (!identity || !preferences) return;
    const next = { ...preferences, ...change };
    setPreferences(next);
    writeBrowserPreferences(identity.pubkey, next);
  };

  if (identityLoading)
    return (
      <p className="p-6 text-sm text-muted-foreground">Loading preferences…</p>
    );
  if (!identity || !preferences) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Unlock a browser identity to manage device preferences.
      </p>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-5 sm:p-8">
      <BrowserSettingsBreadcrumb current="Notifications & accessibility" />
      <header>
        <p className="text-sm text-muted-foreground">This browser only</p>
        <h1 className="mt-1 text-2xl font-semibold">
          Notifications and accessibility
        </h1>
      </header>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Foreground notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Buzz can notify while this tab is open and hidden. It cannot provide
          background push from this setting.
        </p>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input
            checked={preferences.notifications}
            type="checkbox"
            onChange={(event) =>
              update({ notifications: event.target.checked })
            }
          />
          Allow in-app notification prompts
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            disabled={permission === "unsupported" || permission === "granted"}
            type="button"
            variant="outline"
            onClick={() => {
              setError(null);
              void requestBrowserNotifications()
                .then(setPermission)
                .catch(() => {
                  setError(
                    "The browser could not request notification permission.",
                  );
                });
            }}
          >
            {permission === "granted"
              ? "Notifications enabled"
              : permission === "denied"
                ? "Notifications blocked"
                : permission === "unsupported"
                  ? "Notifications unsupported"
                  : "Request notification permission"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Permission is requested only by this button.
          </span>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input
            checked={preferences.notificationSound}
            type="checkbox"
            onChange={(event) =>
              update({ notificationSound: event.target.checked })
            }
          />
          Enable notification sound when browser policy permits
        </label>
        <Button
          className="mt-3"
          type="button"
          variant="outline"
          onClick={() => {
            setError(null);
            try {
              previewNotificationSound();
            } catch (soundError) {
              setError(
                soundError instanceof Error
                  ? soundError.message
                  : "Sound preview failed.",
              );
            }
          }}
        >
          Preview sound
        </Button>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Accessibility</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These settings stay on this relay and browser identity.
        </p>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input
            checked={preferences.reducedMotion}
            type="checkbox"
            onChange={(event) =>
              update({ reducedMotion: event.target.checked })
            }
          />
          Reduce non-essential motion
        </label>
        <label className="mt-4 block text-sm" htmlFor="font-scale">
          Text size
          <select
            className="mt-2 block h-10 rounded-md border border-input bg-background px-3 text-sm"
            id="font-scale"
            value={preferences.fontScale}
            onChange={(event) =>
              update({
                fontScale: event.target
                  .value as BrowserPreferences["fontScale"],
              })
            }
          >
            <option value="default">Default</option>
            <option value="large">Large</option>
            <option value="larger">Larger</option>
          </select>
        </label>
        <p className="mt-4 text-sm text-muted-foreground">
          Keyboard: Tab moves focus, Enter activates controls, and Escape closes
          dialogs. Browser/OS keyboard shortcuts remain authoritative.
        </p>
      </section>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}

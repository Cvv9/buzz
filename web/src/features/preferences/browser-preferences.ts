import { relayWsUrl } from "@/shared/lib/relay-url";

export type BrowserPreferences = {
  version: 1;
  notifications: boolean;
  notificationSound: boolean;
  reducedMotion: boolean;
  fontScale: "default" | "large" | "larger";
};

const DEFAULT_PREFERENCES: BrowserPreferences = {
  version: 1,
  notifications: true,
  notificationSound: false,
  reducedMotion: false,
  fontScale: "default",
};

function key(pubkey: string) {
  return `buzz.web.preferences.v1:${relayWsUrl().toLowerCase()}:${pubkey.toLowerCase()}`;
}

export function readBrowserPreferences(pubkey: string): BrowserPreferences {
  try {
    const stored = JSON.parse(
      localStorage.getItem(key(pubkey)) ?? "",
    ) as Partial<BrowserPreferences>;
    if (stored.version !== 1) return { ...DEFAULT_PREFERENCES };
    return {
      version: 1,
      notifications:
        typeof stored.notifications === "boolean" ? stored.notifications : true,
      notificationSound:
        typeof stored.notificationSound === "boolean"
          ? stored.notificationSound
          : false,
      reducedMotion:
        typeof stored.reducedMotion === "boolean"
          ? stored.reducedMotion
          : false,
      fontScale:
        stored.fontScale === "large" || stored.fontScale === "larger"
          ? stored.fontScale
          : "default",
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writeBrowserPreferences(
  pubkey: string,
  preferences: BrowserPreferences,
) {
  localStorage.setItem(key(pubkey), JSON.stringify(preferences));
  applyBrowserPreferences(preferences);
}

/** Applies only browser-local accessibility preferences to the current document. */
export function applyBrowserPreferences(preferences: BrowserPreferences) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.buzzReducedMotion = preferences.reducedMotion
    ? "true"
    : "false";
  document.documentElement.dataset.buzzFontScale = preferences.fontScale;
}

export function browserNotificationPermission():
  | NotificationPermission
  | "unsupported" {
  return typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
}

/** Must only be called from a user gesture. */
export async function requestBrowserNotifications() {
  if (typeof Notification === "undefined") return "unsupported" as const;
  return Notification.requestPermission();
}

/** Must only be called from a user gesture; never plays on an incoming event. */
export function previewNotificationSound() {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor)
    throw new Error("Web Audio is not supported by this browser.");
  const context = new AudioContextConstructor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  void context.close();
}

export function supportsBrowserPreferences() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

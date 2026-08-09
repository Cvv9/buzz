import {
  isCommunityAppearance,
  type CommunityAppearance,
} from "./community-theme.ts";

const STORAGE_KEY_PREFIX = "buzz-web-community-theme.v1";
const OUTBOX_KEY_PREFIX = "buzz-web-community-theme-outbox.v1";

function normalizedRelayScope(relayUrl: string): string {
  try {
    const url = new URL(relayUrl);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return relayUrl.trim().replace(/\/+$/, "");
  }
}

function scopedKey(prefix: string, pubkey: string, relayUrl: string): string {
  return `${prefix}:${pubkey.toLowerCase()}:${encodeURIComponent(normalizedRelayScope(relayUrl))}`;
}

export function communityThemeStorageKey(
  pubkey: string,
  relayUrl: string,
): string {
  return scopedKey(STORAGE_KEY_PREFIX, pubkey, relayUrl);
}

export function communityThemeOutboxKey(
  pubkey: string,
  relayUrl: string,
): string {
  return scopedKey(OUTBOX_KEY_PREFIX, pubkey, relayUrl);
}

export function parseCommunityThemePreference(
  value: unknown,
): CommunityAppearance | null {
  return isCommunityAppearance(value) ? value : null;
}

function readPreference(key: string): CommunityAppearance | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseCommunityThemePreference(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writePreference(
  key: string,
  preference: CommunityAppearance,
): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

export function readCommunityThemePreference(
  pubkey: string,
  relayUrl: string,
): CommunityAppearance | null {
  return readPreference(communityThemeStorageKey(pubkey, relayUrl));
}

export function writeCommunityThemePreference(
  pubkey: string,
  relayUrl: string,
  preference: CommunityAppearance,
): boolean {
  return writePreference(
    communityThemeStorageKey(pubkey, relayUrl),
    preference,
  );
}

export function readCommunityThemeOutbox(
  pubkey: string,
  relayUrl: string,
): CommunityAppearance | null {
  return readPreference(communityThemeOutboxKey(pubkey, relayUrl));
}

export function writeCommunityThemeOutbox(
  pubkey: string,
  relayUrl: string,
  preference: CommunityAppearance,
): boolean {
  return writePreference(communityThemeOutboxKey(pubkey, relayUrl), preference);
}

export function clearCommunityThemeOutbox(
  pubkey: string,
  relayUrl: string,
  acknowledged: CommunityAppearance,
): void {
  const pending = readCommunityThemeOutbox(pubkey, relayUrl);
  if (!pending || !sameCommunityThemePreference(pending, acknowledged)) return;
  try {
    window.localStorage.removeItem(communityThemeOutboxKey(pubkey, relayUrl));
  } catch {
    // Keep the durable retry marker when storage is unavailable.
  }
}

export function cacheAndApplyCommunityTheme(
  pubkey: string,
  relayUrl: string,
  preference: CommunityAppearance,
  apply: (appearance: CommunityAppearance) => void,
): void {
  writeCommunityThemePreference(pubkey, relayUrl, preference);
  apply(preference);
}

export function sameCommunityThemePreference(
  left: CommunityAppearance,
  right: CommunityAppearance,
): boolean {
  return (
    left.theme === right.theme &&
    left.accent === right.accent &&
    left.followSystem === right.followSystem
  );
}

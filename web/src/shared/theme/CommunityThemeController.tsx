import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  isNewerCommunityThemeCoordinate,
  type CommunityAppearance,
} from "./community-theme";
import {
  cacheAndApplyCommunityTheme,
  clearCommunityThemeOutbox,
  readCommunityThemeOutbox,
  readCommunityThemePreference,
  sameCommunityThemePreference,
  writeCommunityThemeOutbox,
  writeCommunityThemePreference,
} from "./community-theme-preference";
import {
  CommunityThemeSyncManager,
  type RemoteCommunityTheme,
} from "./community-theme-sync";
import { DEFAULT_COMMUNITY_APPEARANCE, useTheme } from "./ThemeProvider";

/**
 * Mirrors the desktop's per-identity `community-theme` NIP-78 state into the
 * browser. The theme event is encrypted to its author, so it only applies when
 * this browser is unlocked with the same Buzz identity as desktop.
 */
export function CommunityThemeController({ pubkey }: { pubkey: string }) {
  const theme = useTheme();
  const managerRef = useRef<CommunityThemeSyncManager | null>(null);
  const scopeRef = useRef("");
  const scopedPreferenceRef = useRef<CommunityAppearance | null>(null);
  const expectedAppliedRef = useRef<CommunityAppearance | null>(null);
  const latestRef = useRef({ createdAt: 0, eventId: "" });
  const scopeReadyRef = useRef(false);
  const currentPreferenceRef = useRef(theme.appearance);
  currentPreferenceRef.current = theme.appearance;

  const applyPreference = useCallback(
    (preference: CommunityAppearance) => {
      expectedAppliedRef.current = sameCommunityThemePreference(
        preference,
        currentPreferenceRef.current,
      )
        ? null
        : preference;
      theme.applyAppearance(preference);
    },
    [theme.applyAppearance],
  );

  // Apply only state owned by this identity and relay before the first paint of
  // the new scope. A prior user's theme never gets a chance to bleed through.
  useLayoutEffect(() => {
    const relayUrl = relayWsUrl();
    const scoped =
      readCommunityThemeOutbox(pubkey, relayUrl) ??
      readCommunityThemePreference(pubkey, relayUrl) ??
      DEFAULT_COMMUNITY_APPEARANCE;
    scopedPreferenceRef.current = scoped;
    applyPreference(scoped);
  }, [applyPreference, pubkey]);

  useEffect(() => {
    const relayUrl = relayWsUrl();
    const scope = `${pubkey}:${relayUrl}`;
    scopeRef.current = scope;
    scopeReadyRef.current = false;
    latestRef.current = { createdAt: 0, eventId: "" };
    const manager = new CommunityThemeSyncManager(
      pubkey,
      relayUrl,
      (published) => {
        if (isNewerCommunityThemeCoordinate(published, latestRef.current)) {
          latestRef.current = {
            createdAt: published.createdAt,
            eventId: published.eventId,
          };
        }
        clearCommunityThemeOutbox(pubkey, relayUrl, published.preference);
      },
    );
    managerRef.current = manager;

    const durablePending = readCommunityThemeOutbox(pubkey, relayUrl);
    if (durablePending) manager.publish(durablePending);

    const applyRemote = (remote: RemoteCommunityTheme) => {
      if (scopeRef.current !== scope) return;
      if (!isNewerCommunityThemeCoordinate(remote, latestRef.current)) return;
      latestRef.current = {
        createdAt: remote.createdAt,
        eventId: remote.eventId,
      };
      manager.acceptRemote(remote);

      // A user edit written while offline is authoritative until this browser
      // can publish it. Do not overwrite it with an older remote rendering.
      const dirty = readCommunityThemeOutbox(pubkey, relayUrl);
      if (dirty) {
        manager.publish(dirty);
        return;
      }

      scopedPreferenceRef.current = remote.preference;
      manager.cancelPendingPublish();
      cacheAndApplyCommunityTheme(
        pubkey,
        relayUrl,
        remote.preference,
        applyPreference,
      );
    };

    void manager.fetchRemote().then((result) => {
      if (scopeRef.current !== scope) return;
      if (result.status === "valid") {
        applyRemote(result.remote);
      } else if (result.status === "absent") {
        const local =
          readCommunityThemeOutbox(pubkey, relayUrl) ??
          readCommunityThemePreference(pubkey, relayUrl) ??
          scopedPreferenceRef.current ??
          DEFAULT_COMMUNITY_APPEARANCE;
        writeCommunityThemePreference(pubkey, relayUrl, local);
        writeCommunityThemeOutbox(pubkey, relayUrl, local);
        manager.publish(local);
      } else {
        // An edit can arrive while the initial request is offline. It is
        // already durable in the outbox, so resume its retry loop once this
        // scope has been initialized rather than waiting for another edit.
        const pending = readCommunityThemeOutbox(pubkey, relayUrl);
        if (pending) manager.publish(pending);
      }
      // Invalid and unavailable state leave the scoped local/default theme in
      // place; neither condition is safe to overwrite remotely.
      scopeReadyRef.current = true;
    });

    const unsubscribe = manager.subscribe(applyRemote);
    return () => {
      if (scopeRef.current === scope) {
        scopeRef.current = "";
        scopeReadyRef.current = false;
      }
      manager.destroy();
      if (managerRef.current === manager) managerRef.current = null;
      unsubscribe();
    };
  }, [applyPreference, pubkey]);

  useEffect(() => {
    const relayUrl = relayWsUrl();
    const preference = theme.appearance;
    const expected = expectedAppliedRef.current;
    if (expected && sameCommunityThemePreference(expected, preference)) {
      expectedAppliedRef.current = null;
      return;
    }
    expectedAppliedRef.current = null;

    const scoped = scopedPreferenceRef.current;
    if (!scopeReadyRef.current) {
      // A deliberate edit can happen before the remote query settles. Put it
      // in the outbox immediately so that a late remote result cannot undo it.
      if (scoped && sameCommunityThemePreference(scoped, preference)) return;
      scopedPreferenceRef.current = preference;
      writeCommunityThemePreference(pubkey, relayUrl, preference);
      writeCommunityThemeOutbox(pubkey, relayUrl, preference);
      return;
    }

    const stored = readCommunityThemePreference(pubkey, relayUrl);
    if (stored && sameCommunityThemePreference(stored, preference)) return;
    scopedPreferenceRef.current = preference;
    writeCommunityThemePreference(pubkey, relayUrl, preference);
    writeCommunityThemeOutbox(pubkey, relayUrl, preference);
    managerRef.current?.publish(preference);
  }, [pubkey, theme.appearance]);

  return null;
}

import { useEffect, useRef } from "react";
import {
  type NostrEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { nip44DecryptFromSelf } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  COMMUNITY_THEME_D_TAG,
  COMMUNITY_THEME_KIND,
  isCommunityAppearance,
  isNewerCommunityThemeCoordinate,
  type CommunityAppearance,
} from "./community-theme";
import { DEFAULT_COMMUNITY_APPEARANCE, useTheme } from "./ThemeProvider";

function themeCoordinate(event: NostrEvent) {
  return { createdAt: event.created_at, eventId: event.id };
}

async function decodeAppearance(
  pubkey: string,
  event: NostrEvent,
): Promise<CommunityAppearance | null> {
  try {
    const parsed: unknown = JSON.parse(
      await nip44DecryptFromSelf(pubkey, event.content),
    );
    return isCommunityAppearance(parsed) ? parsed : null;
  } catch {
    // A preference is private state. Never let a malformed or undecryptable
    // event affect the browser's current appearance.
    return null;
  }
}

/**
 * Mirrors the desktop's per-identity `community-theme` NIP-78 state into the
 * browser. The theme event is encrypted to its author, so it only applies when
 * this browser is unlocked with the same Buzz identity as desktop.
 */
export function CommunityThemeController({ pubkey }: { pubkey: string }) {
  const { applyAppearance } = useTheme();
  const latest = useRef({ createdAt: 0, eventId: "" });

  useEffect(() => {
    let disposed = false;
    latest.current = { createdAt: 0, eventId: "" };
    // Appearance is identity-private. Reset before reading the new identity's
    // encrypted state so another user's preference cannot briefly carry over.
    applyAppearance(DEFAULT_COMMUNITY_APPEARANCE);
    const filter = {
      kinds: [COMMUNITY_THEME_KIND],
      authors: [pubkey],
      "#d": [COMMUNITY_THEME_D_TAG],
      limit: 50,
    };

    const receive = (event: NostrEvent) => {
      const coordinate = themeCoordinate(event);
      if (!isNewerCommunityThemeCoordinate(coordinate, latest.current)) return;
      void decodeAppearance(pubkey, event).then((appearance) => {
        if (
          !appearance ||
          disposed ||
          !isNewerCommunityThemeCoordinate(coordinate, latest.current)
        ) {
          return;
        }
        latest.current = coordinate;
        applyAppearance(appearance);
      });
    };

    void queryEvents(relayWsUrl(), filter)
      .then((events) => {
        for (const event of events) receive(event);
      })
      .catch(() => {
        // The local/default theme remains visible while the relay is offline.
      });
    const unsubscribe = subscribeEvents(relayWsUrl(), filter, receive);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [applyAppearance, pubkey]);

  return null;
}

import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";
import {
  COMMUNITY_THEME_D_TAG,
  COMMUNITY_THEME_KIND,
  isCommunityAppearance,
  isNewerCommunityThemeCoordinate,
  type CommunityAppearance,
} from "./community-theme";
import { sameCommunityThemePreference } from "./community-theme-preference";

const PUBLISH_DEBOUNCE_MS = 500;
const PUBLISH_RETRY_BASE_MS = 1_000;
const PUBLISH_RETRY_MAX_MS = 30_000;

export type RemoteCommunityTheme = {
  preference: CommunityAppearance;
  createdAt: number;
  eventId: string;
};

export type RemoteCommunityThemeResult =
  | { status: "valid"; remote: RemoteCommunityTheme }
  | { status: "absent" | "invalid" | "unavailable" };

function coordinate(event: NostrEvent) {
  return { createdAt: event.created_at, eventId: event.id };
}

async function decryptAndParse(
  pubkey: string,
  event: NostrEvent,
): Promise<RemoteCommunityTheme | null> {
  if (event.pubkey !== pubkey) return null;
  try {
    const parsed: unknown = JSON.parse(
      await nip44DecryptFromSelf(pubkey, event.content),
    );
    return isCommunityAppearance(parsed)
      ? { preference: parsed, ...coordinate(event) }
      : null;
  } catch {
    return null;
  }
}

/**
 * Durable NIP-78 publisher for a single user/relay coordinate. The caller
 * keeps the latest desired preference in localStorage; this manager only owns
 * debouncing, retrying, and monotonic event timestamps.
 */
export class CommunityThemeSyncManager {
  private debounceTimer: number | null = null;
  private destroyed = false;
  private lastRemote = { createdAt: 0, eventId: "" };
  private lastPublished: RemoteCommunityTheme | null = null;
  private pending: CommunityAppearance | null = null;
  private publishInFlight = false;
  private retryAttempt = 0;

  constructor(
    private readonly pubkey: string,
    private readonly relayUrl: string,
    private readonly onPublished: (
      published: RemoteCommunityTheme,
    ) => void = () => {},
  ) {}

  async fetchRemote(): Promise<RemoteCommunityThemeResult> {
    try {
      const events = await queryEvents(this.relayUrl, {
        kinds: [COMMUNITY_THEME_KIND],
        authors: [this.pubkey],
        "#d": [COMMUNITY_THEME_D_TAG],
        limit: 50,
      });
      if (events.length === 0) return { status: "absent" };

      const candidates = await Promise.all(
        events.map((event) => decryptAndParse(this.pubkey, event)),
      );
      const remote = candidates.reduce<RemoteCommunityTheme | null>(
        (newest, candidate) =>
          candidate &&
          (!newest || isNewerCommunityThemeCoordinate(candidate, newest))
            ? candidate
            : newest,
        null,
      );
      if (!remote) return { status: "invalid" };
      this.acceptRemote(remote);
      return { status: "valid", remote };
    } catch {
      return { status: "unavailable" };
    }
  }

  publish(preference: CommunityAppearance): void {
    if (this.destroyed) return;
    this.pending = preference;
    this.retryAttempt = 0;
    this.schedulePublish(PUBLISH_DEBOUNCE_MS);
  }

  acceptRemote(remote: RemoteCommunityTheme): void {
    if (isNewerCommunityThemeCoordinate(remote, this.lastRemote)) {
      this.lastRemote = {
        createdAt: remote.createdAt,
        eventId: remote.eventId,
      };
    }
    if (
      this.lastPublished &&
      (this.lastPublished.createdAt !== remote.createdAt ||
        this.lastPublished.eventId !== remote.eventId)
    ) {
      this.lastPublished = null;
    }
  }

  cancelPendingPublish(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pending = null;
  }

  subscribe(onUpdate: (remote: RemoteCommunityTheme) => void): () => void {
    return subscribeEvents(
      this.relayUrl,
      {
        kinds: [COMMUNITY_THEME_KIND],
        authors: [this.pubkey],
        "#d": [COMMUNITY_THEME_D_TAG],
        limit: 0,
      },
      (event) => {
        void decryptAndParse(this.pubkey, event).then((remote) => {
          if (!remote || this.destroyed) return;
          this.acceptRemote(remote);
          onUpdate(remote);
        });
      },
    );
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelPendingPublish();
  }

  private schedulePublish(delayMs: number): void {
    if (this.destroyed) return;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.startPublish();
    }, delayMs);
  }

  private startPublish(): void {
    if (this.destroyed || this.publishInFlight || !this.pending) return;
    const preference = this.pending;
    this.publishInFlight = true;
    void this.doPublish(preference).finally(() => {
      this.publishInFlight = false;
      if (
        !this.destroyed &&
        this.pending &&
        !sameCommunityThemePreference(this.pending, preference) &&
        this.debounceTimer === null
      ) {
        this.schedulePublish(0);
      }
    });
  }

  private async doPublish(preference: CommunityAppearance): Promise<void> {
    try {
      if (
        this.destroyed ||
        (this.lastPublished &&
          sameCommunityThemePreference(
            this.lastPublished.preference,
            preference,
          ))
      ) {
        if (
          this.pending &&
          sameCommunityThemePreference(this.pending, preference)
        ) {
          this.pending = null;
          if (this.lastPublished) this.onPublished(this.lastPublished);
        }
        return;
      }

      const event = await publishEvent(this.relayUrl, {
        kind: COMMUNITY_THEME_KIND,
        content: await nip44EncryptToSelf(
          this.pubkey,
          JSON.stringify(preference),
        ),
        created_at: Math.max(
          Math.floor(Date.now() / 1_000),
          this.lastRemote.createdAt + 1,
        ),
        tags: [
          ["d", COMMUNITY_THEME_D_TAG],
          ["t", COMMUNITY_THEME_D_TAG],
        ],
      });
      if (this.destroyed) return;

      const published = { preference, ...coordinate(event) };
      const remoteWon = isNewerCommunityThemeCoordinate(
        this.lastRemote,
        published,
      );
      if (remoteWon) {
        this.lastPublished = null;
        if (
          this.pending &&
          sameCommunityThemePreference(this.pending, preference)
        ) {
          this.schedulePublish(0);
        }
        return;
      }

      this.lastRemote = {
        createdAt: published.createdAt,
        eventId: published.eventId,
      };
      this.lastPublished = published;
      this.retryAttempt = 0;
      if (
        this.pending &&
        sameCommunityThemePreference(this.pending, preference)
      ) {
        this.pending = null;
      }
      this.onPublished(published);
    } catch {
      if (
        this.destroyed ||
        !this.pending ||
        !sameCommunityThemePreference(this.pending, preference)
      ) {
        return;
      }
      const delay = Math.min(
        PUBLISH_RETRY_BASE_MS * 2 ** this.retryAttempt,
        PUBLISH_RETRY_MAX_MS,
      );
      this.retryAttempt += 1;
      this.schedulePublish(delay);
    }
  }
}

import * as React from "react";
import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";

export const KIND_PRESENCE_UPDATE = 20001;
export const KIND_TYPING_INDICATOR = 20002;
export type PresenceStatus = "online" | "away" | "offline";
type PresenceEntry = { status: PresenceStatus; expiresAt: number };

const PRESENCE_HEARTBEAT_MS = 60_000;
const PRESENCE_TTL_MS = 180_000;
const IDLE_AWAY_MS = 10 * 60_000;
const TYPING_TTL_MS = 8_000;
const TYPING_INTERVAL_MS = 3_000;

function validPubkey(value: string) {
  return /^[0-9a-f]{64}$/i.test(value);
}

function channelId(event: NostrEvent) {
  return event.tags.find((tag) => tag[0] === "h")?.[1] ?? null;
}

function subjectFromSnapshot(event: NostrEvent) {
  const subjects = event.tags.filter(
    (tag): tag is [string, string, ...string[]] =>
      tag[0] === "p" && typeof tag[1] === "string",
  );
  return subjects.length === 1 && validPubkey(subjects[0][1])
    ? subjects[0][1].toLowerCase()
    : null;
}

function status(content: string): PresenceStatus | null {
  return content === "online" || content === "away" || content === "offline"
    ? content
    : null;
}

/**
 * Ephemeral presence lives in a local TTL map rather than React Query, so an
 * account/reconnect cannot resurrect stale availability as durable state.
 */
export function useWorkspacePresence(
  viewerPubkey: string | undefined,
  memberPubkeys: string[],
) {
  const members = React.useMemo(
    () =>
      [
        ...new Set(
          memberPubkeys
            .map((pubkey) => pubkey.toLowerCase())
            .filter(validPubkey),
        ),
      ].sort(),
    [memberPubkeys],
  );
  const [presence, setPresence] = React.useState<Record<string, PresenceEntry>>(
    {},
  );

  React.useEffect(() => {
    setPresence({});
    if (!viewerPubkey || members.length === 0) return;
    let cancelled = false;
    const allowed = new Set(members);
    const apply = (event: NostrEvent, allowRelaySnapshot: boolean) => {
      const nextStatus = status(event.content);
      const author = event.pubkey.toLowerCase();
      const subject =
        allowRelaySnapshot && !allowed.has(author)
          ? subjectFromSnapshot(event)
          : author;
      if (!nextStatus || !subject || !allowed.has(subject)) return;
      const expiresAt = Math.min(
        Date.now() + PRESENCE_TTL_MS,
        event.created_at * 1_000 + PRESENCE_TTL_MS,
      );
      if (expiresAt <= Date.now()) return;
      setPresence((current) => ({
        ...current,
        [subject]: { status: nextStatus, expiresAt },
      }));
    };
    const refresh = () =>
      void queryEvents(relayWsUrl(), {
        kinds: [KIND_PRESENCE_UPDATE],
        authors: members,
      })
        .then((events) => {
          if (cancelled) return;
          setPresence({});
          events.forEach((event) => {
            apply(event, true);
          });
        })
        .catch(() => {});
    refresh();
    const stop = subscribeEvents(
      relayWsUrl(),
      {
        kinds: [KIND_PRESENCE_UPDATE],
        authors: members,
        since: Math.floor(Date.now() / 1_000),
      },
      (event) => apply(event, false),
      (connection) => {
        if (connection === "closed") setPresence({});
        if (connection === "live") refresh();
      },
    );
    const prune = window.setInterval(() => {
      const now = Date.now();
      setPresence((current) => {
        const entries = Object.entries(current).filter(
          ([, entry]) => entry.expiresAt > now,
        );
        return entries.length === Object.keys(current).length
          ? current
          : Object.fromEntries(entries);
      });
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(prune);
      stop();
    };
  }, [members, viewerPubkey]);

  return React.useMemo(
    () =>
      Object.fromEntries(
        Object.entries(presence).map(([pubkey, entry]) => [
          pubkey,
          entry.status,
        ]),
      ) as Record<string, PresenceStatus>,
    [presence],
  );
}

/** Browser visibility and in-app activity adapt presence without persistence. */
export function usePresenceHeartbeat(pubkey?: string) {
  React.useEffect(() => {
    if (!pubkey || !validPubkey(pubkey)) return;
    let lastActivity = Date.now();
    let lastStatus: PresenceStatus | null = null;
    const send = (next: PresenceStatus) => {
      if (next === lastStatus) return;
      lastStatus = next;
      void publishEvent(relayWsUrl(), {
        kind: KIND_PRESENCE_UPDATE,
        content: next,
        tags: [],
      }).catch(() => {});
    };
    const resolve = () => {
      const next =
        document.hidden || Date.now() - lastActivity >= IDLE_AWAY_MS
          ? "away"
          : "online";
      send(next);
    };
    const recordActivity = () => {
      lastActivity = Date.now();
      if (!document.hidden) send("online");
    };
    const visibility = () => resolve();
    window.addEventListener("pointerdown", recordActivity, true);
    window.addEventListener("keydown", recordActivity, true);
    window.addEventListener("focus", recordActivity);
    document.addEventListener("visibilitychange", visibility);
    resolve();
    const heartbeat = window.setInterval(() => {
      lastStatus = null;
      resolve();
    }, PRESENCE_HEARTBEAT_MS);
    const idleCheck = window.setInterval(resolve, 30_000);
    return () => {
      window.removeEventListener("pointerdown", recordActivity, true);
      window.removeEventListener("keydown", recordActivity, true);
      window.removeEventListener("focus", recordActivity);
      document.removeEventListener("visibilitychange", visibility);
      window.clearInterval(heartbeat);
      window.clearInterval(idleCheck);
      void publishEvent(relayWsUrl(), {
        kind: KIND_PRESENCE_UPDATE,
        content: "offline",
        tags: [],
      }).catch(() => {});
    };
  }, [pubkey]);
}

export function useTypingBroadcast(channelId: string | null) {
  const lastSent = React.useRef(0);
  const currentChannel = React.useRef(channelId);
  currentChannel.current = channelId;
  return React.useCallback(() => {
    const channel = currentChannel.current;
    if (
      !channel ||
      document.hidden ||
      Date.now() - lastSent.current < TYPING_INTERVAL_MS
    )
      return;
    lastSent.current = Date.now();
    void publishEvent(relayWsUrl(), {
      kind: KIND_TYPING_INDICATOR,
      content: "",
      tags: [["h", channel]],
    }).catch(() => {});
  }, []);
}

export function useChannelTyping(
  channelIdValue: string | null,
  viewerPubkey: string | undefined,
  memberPubkeys: string[],
) {
  const members = React.useMemo(
    () =>
      new Set(
        memberPubkeys.map((pubkey) => pubkey.toLowerCase()).filter(validPubkey),
      ),
    [memberPubkeys],
  );
  const [typers, setTypers] = React.useState<string[]>([]);
  React.useEffect(() => {
    setTypers([]);
    if (!channelIdValue || !viewerPubkey) return;
    let cancelled = false;
    const expires = new Map<string, number>();
    const accept = (event: NostrEvent) => {
      const author = event.pubkey.toLowerCase();
      const expiry = Math.min(
        Date.now() + TYPING_TTL_MS,
        event.created_at * 1_000 + TYPING_TTL_MS,
      );
      if (
        event.kind !== KIND_TYPING_INDICATOR ||
        channelId(event) !== channelIdValue ||
        author === viewerPubkey.toLowerCase() ||
        !members.has(author) ||
        expiry <= Date.now()
      ) {
        return;
      }
      expires.set(author, expiry);
      setTypers([...expires.keys()]);
    };
    const stop = subscribeEvents(
      relayWsUrl(),
      {
        kinds: [KIND_TYPING_INDICATOR],
        "#h": [channelIdValue],
        since: Math.floor(Date.now() / 1_000),
      },
      accept,
      (connection) => {
        if (connection === "closed" && !cancelled) {
          expires.clear();
          setTypers([]);
        }
      },
    );
    const prune = window.setInterval(() => {
      const now = Date.now();
      for (const [pubkey, expiry] of expires)
        if (expiry <= now) expires.delete(pubkey);
      setTypers([...expires.keys()]);
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(prune);
      stop();
    };
  }, [channelIdValue, members, viewerPubkey]);
  return typers;
}

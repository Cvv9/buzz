/**
 * Minimal Nostr client with NIP-01 queries and NIP-42 AUTH.
 *
 * Uses NIP-07 when a browser extension is available, with an ephemeral
 * page-lifetime identity as the fallback for read-only queries on open relays.
 */

import { makeAuthEvent } from "nostr-tools/nip42";
import {
  type SignedNostrEvent,
  signNostrEvent,
} from "@/shared/lib/nostr-signer";

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

export type NostrEvent = SignedNostrEvent;

const QUERY_TIMEOUT_MS = 10_000;
const PUBLISH_TIMEOUT_MS = 10_000;

type RelayEnvelope = unknown[];

function parseEnvelope(data: unknown): RelayEnvelope | null {
  try {
    const parsed = JSON.parse(String(data));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Open a WebSocket to `wsUrl`, authenticate via NIP-42 if challenged,
 * send a REQ with the given filter, collect EVENTs until EOSE, then
 * close and return them.
 */
export function queryEvents(
  wsUrl: string,
  filter: NostrFilter,
): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    const subId = `q-${Date.now().toString(36)}`;
    let settled = false;
    let reqSent = false;
    let authEventId: string | null = null;
    let unauthenticatedReqTimer: ReturnType<typeof setTimeout> | null = null;

    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Relay query timed out after ${QUERY_TIMEOUT_MS}ms`));
      }
    }, QUERY_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      if (unauthenticatedReqTimer) {
        clearTimeout(unauthenticatedReqTimer);
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    const sendReq = () => {
      if (!reqSent) {
        reqSent = true;
        ws.send(JSON.stringify(["REQ", subId, filter]));
      }
    };

    ws.addEventListener("open", () => {
      // Wait briefly for an AUTH challenge before sending REQ.
      // Buzz relays always send AUTH, but other relays may not.
      unauthenticatedReqTimer = setTimeout(() => sendReq(), 100);
    });

    ws.addEventListener("message", async (msg) => {
      const data = parseEnvelope(msg.data);
      if (!data) return;

      const [type] = data;

      if (type === "AUTH" && typeof data[1] === "string") {
        // NIP-42: relay sent an AUTH challenge — sign and respond.
        if (unauthenticatedReqTimer) {
          clearTimeout(unauthenticatedReqTimer);
          unauthenticatedReqTimer = null;
        }
        const challenge = data[1];
        const template = makeAuthEvent(wsUrl, challenge);
        try {
          const signed = await signNostrEvent(template);
          if (settled) return;
          authEventId = signed.id;
          ws.send(JSON.stringify(["AUTH", signed]));
        } catch (error) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(
              error instanceof Error
                ? error
                : new Error("Failed to sign relay authentication."),
            );
          }
        }
        return;
      }

      if (type === "OK" && data[1] === authEventId) {
        if (data[2] === true) {
          sendReq();
        } else if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay authentication failed.",
            ),
          );
        }
        return;
      }

      if (type === "EVENT" && data[1] === subId && data[2]) {
        events.push(data[2] as NostrEvent);
      } else if (type === "EOSE" && data[1] === subId) {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(events);
        }
      } else if (type === "CLOSED" && data[1] === subId) {
        // Subscription was rejected (e.g. auth failed).
        if (!settled) {
          settled = true;
          cleanup();
          const reason =
            typeof data[2] === "string"
              ? data[2]
              : "subscription closed by relay";
          reject(new Error(reason));
        }
      } else if (type === "NOTICE") {
        // Informational notice from relay — ignore for now.
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("WebSocket connection failed"));
      }
    });

    ws.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(events);
      }
    });
  });
}

export async function publishEvent(
  wsUrl: string,
  template: Parameters<typeof signNostrEvent>[0],
): Promise<NostrEvent> {
  const event = await signNostrEvent(template, { requireNip07: true });
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let authenticated = false;
    let authEventId: string | null = null;

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("Publishing to the relay timed out."));
    }, PUBLISH_TIMEOUT_MS);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      ws.close();
      if (error) reject(error);
      else resolve(event);
    };

    const sendEvent = () => {
      if (authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(["EVENT", event]));
      }
    };

    ws.addEventListener("message", async (message) => {
      const data = parseEnvelope(message.data);
      if (!data) return;
      if (data[0] === "AUTH" && typeof data[1] === "string") {
        try {
          const signedAuth = await signNostrEvent(
            makeAuthEvent(wsUrl, data[1]),
            { requireNip07: true },
          );
          authEventId = signedAuth.id;
          ws.send(JSON.stringify(["AUTH", signedAuth]));
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("Relay authentication failed."),
          );
        }
        return;
      }
      if (data[0] !== "OK") return;
      if (data[1] === authEventId) {
        if (data[2] === true) {
          authenticated = true;
          sendEvent();
        } else {
          finish(
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay authentication failed.",
            ),
          );
        }
      } else if (data[1] === event.id) {
        finish(
          data[2] === true
            ? undefined
            : new Error(
                typeof data[3] === "string"
                  ? data[3]
                  : "The relay rejected the event.",
              ),
        );
      }
    });
    ws.addEventListener("error", () =>
      finish(new Error("Could not connect to the Buzz relay.")),
    );
    ws.addEventListener("close", () => {
      if (!settled) finish(new Error("The relay closed the connection."));
    });
  });
}

export function subscribeEvents(
  wsUrl: string,
  filter: NostrFilter,
  onEvent: (event: NostrEvent) => void,
  onStatus?: (status: "connecting" | "live" | "closed", error?: Error) => void,
): () => void {
  const ws = new WebSocket(wsUrl);
  const subId = `live-${crypto.randomUUID()}`;
  let stopped = false;
  let authEventId: string | null = null;
  let reqSent = false;

  const close = () => {
    if (stopped) return;
    stopped = true;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(["CLOSE", subId]));
    }
    ws.close();
  };

  const sendReq = () => {
    if (stopped || reqSent || ws.readyState !== WebSocket.OPEN) return;
    reqSent = true;
    ws.send(JSON.stringify(["REQ", subId, filter]));
  };

  onStatus?.("connecting");
  ws.addEventListener("message", async (message) => {
    const data = parseEnvelope(message.data);
    if (!data || stopped) return;
    if (data[0] === "AUTH" && typeof data[1] === "string") {
      try {
        const auth = await signNostrEvent(makeAuthEvent(wsUrl, data[1]), {
          requireNip07: true,
        });
        authEventId = auth.id;
        ws.send(JSON.stringify(["AUTH", auth]));
      } catch (error) {
        onStatus?.(
          "closed",
          error instanceof Error ? error : new Error("Authentication failed."),
        );
        close();
      }
      return;
    }
    if (data[0] === "OK" && data[1] === authEventId) {
      if (data[2] === true) sendReq();
      else {
        onStatus?.(
          "closed",
          new Error(
            typeof data[3] === "string"
              ? data[3]
              : "Relay authentication failed.",
          ),
        );
        close();
      }
      return;
    }
    if (data[0] === "EVENT" && data[1] === subId && data[2]) {
      onEvent(data[2] as NostrEvent);
    } else if (data[0] === "EOSE" && data[1] === subId) {
      onStatus?.("live");
    } else if (data[0] === "CLOSED" && data[1] === subId) {
      onStatus?.(
        "closed",
        new Error(
          typeof data[2] === "string"
            ? data[2]
            : "The relay closed the subscription.",
        ),
      );
      close();
    }
  });
  ws.addEventListener("error", () => {
    onStatus?.("closed", new Error("The realtime connection failed."));
  });
  ws.addEventListener("close", () => {
    if (!stopped) onStatus?.("closed");
  });
  return close;
}

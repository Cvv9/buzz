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
  /** NIP-50 full-text query. Relay requests must still declare `kinds`. */
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

export type NostrEvent = SignedNostrEvent;

/** Relay acknowledgement retained for command kinds with a Nostr `OK` response body. */
export type PublishedEvent = {
  event: NostrEvent;
  relayMessage: string | null;
};

const QUERY_TIMEOUT_MS = 10_000;
const PUBLISH_TIMEOUT_MS = 10_000;
const SHARED_RETRY_COOLDOWN_MS = 5_000;

type RelayEnvelope = unknown[];

function parseEnvelope(data: unknown): RelayEnvelope | null {
  try {
    const parsed = JSON.parse(String(data));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Shared authenticated connection ────────────────────────────────────────
//
// Historically every query and publish opened its own WebSocket and performed
// a full NIP-42 AUTH round trip, which made each send and each channel load
// pay a connection handshake plus two signatures. Queries and publishes now
// multiplex over one persistent authenticated socket; the per-call socket
// code below remains as the fallback when the shared transport is
// unavailable (no durable signer yet, relay closed the connection, …).

type SharedSubscription = {
  onEvent: (event: NostrEvent) => void;
  onEose: () => void;
  onClosed: (reason: string) => void;
  onDisconnect: () => void;
};

type SharedOkResult = {
  accepted: boolean;
  message: string | null;
  connectionLost: boolean;
};

type SharedConnection = {
  url: string;
  ws: WebSocket;
  ready: Promise<void>;
  subscriptions: Map<string, SharedSubscription>;
  okWaiters: Map<string, (result: SharedOkResult) => void>;
};

let activeSharedConnection: SharedConnection | null = null;
let sharedUnavailableUntil = 0;

function createSharedConnection(wsUrl: string): SharedConnection {
  const ws = new WebSocket(wsUrl);
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // The ready promise is awaited lazily; avoid unhandled-rejection noise.
  ready.catch(() => {});

  const connection: SharedConnection = {
    url: wsUrl,
    ws,
    ready,
    subscriptions: new Map(),
    okWaiters: new Map(),
  };

  let readySettled = false;
  let authEventId: string | null = null;
  let authTimer: number | null = null;

  const settleReady = (error?: Error) => {
    if (readySettled) return;
    readySettled = true;
    if (authTimer !== null) window.clearTimeout(authTimer);
    if (error) {
      sharedUnavailableUntil = Date.now() + SHARED_RETRY_COOLDOWN_MS;
      readyReject(error);
    } else {
      readyResolve();
    }
  };

  const dropConnection = () => {
    settleReady(new Error("The relay connection closed."));
    for (const subscription of connection.subscriptions.values()) {
      subscription.onDisconnect();
    }
    connection.subscriptions.clear();
    for (const waiter of connection.okWaiters.values()) {
      waiter({ accepted: false, message: null, connectionLost: true });
    }
    connection.okWaiters.clear();
    if (activeSharedConnection === connection) activeSharedConnection = null;
  };

  ws.addEventListener("open", () => {
    // Buzz relays challenge immediately; give the AUTH frame a beat to
    // arrive, then proceed unauthenticated for open relays.
    authTimer = window.setTimeout(() => settleReady(), 150);
  });

  ws.addEventListener("message", async (message) => {
    const data = parseEnvelope(message.data);
    if (!data) return;
    const [type] = data;
    if (type === "AUTH" && typeof data[1] === "string") {
      if (authTimer !== null) {
        window.clearTimeout(authTimer);
        authTimer = null;
      }
      try {
        const signed = await signNostrEvent(makeAuthEvent(wsUrl, data[1]), {
          requireNip07: true,
        });
        authEventId = signed.id;
        ws.send(JSON.stringify(["AUTH", signed]));
      } catch (error) {
        settleReady(
          error instanceof Error
            ? error
            : new Error("Relay authentication failed."),
        );
        ws.close();
      }
      return;
    }
    if (type === "OK" && typeof data[1] === "string") {
      if (data[1] === authEventId) {
        if (data[2] === true) settleReady();
        else {
          settleReady(
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay authentication failed.",
            ),
          );
          ws.close();
        }
        return;
      }
      const waiter = connection.okWaiters.get(data[1]);
      if (waiter) {
        connection.okWaiters.delete(data[1]);
        waiter({
          accepted: data[2] === true,
          message: typeof data[3] === "string" ? data[3] : null,
          connectionLost: false,
        });
      }
      return;
    }
    if (type === "EVENT" && typeof data[1] === "string" && data[2]) {
      connection.subscriptions.get(data[1])?.onEvent(data[2] as NostrEvent);
    } else if (type === "EOSE" && typeof data[1] === "string") {
      connection.subscriptions.get(data[1])?.onEose();
    } else if (type === "CLOSED" && typeof data[1] === "string") {
      const subscription = connection.subscriptions.get(data[1]);
      connection.subscriptions.delete(data[1]);
      subscription?.onClosed(
        typeof data[2] === "string" ? data[2] : "subscription closed by relay",
      );
    }
  });

  ws.addEventListener("error", () => ws.close());
  ws.addEventListener("close", dropConnection);
  return connection;
}

async function acquireSharedConnection(
  wsUrl: string,
): Promise<SharedConnection> {
  if (Date.now() < sharedUnavailableUntil) {
    throw new Error("The shared relay transport is cooling down.");
  }
  let connection = activeSharedConnection;
  if (
    !connection ||
    connection.url !== wsUrl ||
    (connection.ws.readyState !== WebSocket.OPEN &&
      connection.ws.readyState !== WebSocket.CONNECTING)
  ) {
    connection = createSharedConnection(wsUrl);
    activeSharedConnection = connection;
  }
  await connection.ready;
  if (connection.ws.readyState !== WebSocket.OPEN) {
    throw new Error("The relay connection closed.");
  }
  return connection;
}

function runSharedQuery(
  connection: SharedConnection,
  filter: NostrFilter,
): Promise<{ events: NostrEvent[]; connectionLost: boolean }> {
  return new Promise((resolve, reject) => {
    const subId = `q-${crypto.randomUUID()}`;
    const events: NostrEvent[] = [];
    let settled = false;
    const finish = (
      outcome:
        | { kind: "done" }
        | { kind: "disconnect" }
        | { kind: "error"; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      connection.subscriptions.delete(subId);
      if (outcome.kind === "error") reject(outcome.error);
      else resolve({ events, connectionLost: outcome.kind === "disconnect" });
    };
    const timeout = window.setTimeout(() => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(JSON.stringify(["CLOSE", subId]));
        } catch {
          // The subscription entry is already removed below.
        }
      }
      finish({
        kind: "error",
        error: new Error(`Relay query timed out after ${QUERY_TIMEOUT_MS}ms`),
      });
    }, QUERY_TIMEOUT_MS);
    connection.subscriptions.set(subId, {
      onEvent: (event) => events.push(event),
      onEose: () => {
        if (connection.ws.readyState === WebSocket.OPEN) {
          try {
            connection.ws.send(JSON.stringify(["CLOSE", subId]));
          } catch {
            // Closing the finished subscription is best-effort.
          }
        }
        finish({ kind: "done" });
      },
      onClosed: (reason) => finish({ kind: "error", error: new Error(reason) }),
      onDisconnect: () => finish({ kind: "disconnect" }),
    });
    connection.ws.send(JSON.stringify(["REQ", subId, filter]));
  });
}

/**
 * Query the relay for events matching `filter`, collecting until EOSE.
 * Runs over the shared authenticated socket when possible, falling back to
 * a dedicated per-call socket otherwise.
 */
export async function queryEvents(
  wsUrl: string,
  filter: NostrFilter,
): Promise<NostrEvent[]> {
  let connection: SharedConnection;
  try {
    connection = await acquireSharedConnection(wsUrl);
  } catch {
    return queryEventsWithDedicatedSocket(wsUrl, filter);
  }
  const result = await runSharedQuery(connection, filter);
  if (result.connectionLost) {
    return queryEventsWithDedicatedSocket(wsUrl, filter);
  }
  return result.events;
}

/**
 * Open a WebSocket to `wsUrl`, authenticate via NIP-42 if challenged,
 * send a REQ with the given filter, collect EVENTs until EOSE, then
 * close and return them.
 */
function queryEventsWithDedicatedSocket(
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
  return (await publishEventWithReceipt(wsUrl, template)).event;
}

/**
 * Publish a signed event and retain the relay's accepted `OK` message. Command
 * handlers use this standard Nostr acknowledgement to return a run identifier
 * or one-time webhook secret; no feature-specific HTTP endpoint is involved.
 * Uses the shared authenticated socket when possible; a dropped connection
 * retries once over a dedicated socket (relays deduplicate by event id).
 */
export async function publishEventWithReceipt(
  wsUrl: string,
  template: Parameters<typeof signNostrEvent>[0],
): Promise<PublishedEvent> {
  const event = await signNostrEvent(template, { requireNip07: true });
  let connection: SharedConnection | null = null;
  try {
    connection = await acquireSharedConnection(wsUrl);
  } catch {
    connection = null;
  }
  if (connection) {
    const shared = connection;
    const result = await new Promise<SharedOkResult>((resolve) => {
      const timeout = window.setTimeout(() => {
        shared.okWaiters.delete(event.id);
        resolve({
          accepted: false,
          message: "Publishing to the relay timed out.",
          connectionLost: false,
        });
      }, PUBLISH_TIMEOUT_MS);
      shared.okWaiters.set(event.id, (outcome) => {
        window.clearTimeout(timeout);
        resolve(outcome);
      });
      try {
        shared.ws.send(JSON.stringify(["EVENT", event]));
      } catch {
        window.clearTimeout(timeout);
        shared.okWaiters.delete(event.id);
        resolve({ accepted: false, message: null, connectionLost: true });
      }
    });
    if (result.accepted) {
      return { event, relayMessage: result.message };
    }
    if (!result.connectionLost) {
      throw new Error(result.message ?? "The relay rejected the event.");
    }
    // Connection dropped before the acknowledgement — retry below.
  }
  return publishSignedEventWithDedicatedSocket(wsUrl, event);
}

function publishSignedEventWithDedicatedSocket(
  wsUrl: string,
  event: NostrEvent,
): Promise<PublishedEvent> {
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

    const finish = (error?: Error, relayMessage: string | null = null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      ws.close();
      if (error) reject(error);
      else resolve({ event, relayMessage });
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
          typeof data[3] === "string" ? data[3] : null,
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
  let stopped = false;
  let reconnectAttempt = 0;
  let reconnectTimer: number | null = null;
  let ws: WebSocket | null = null;
  let activeSubId: string | null = null;

  const close = () => {
    if (stopped) return;
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    if (ws?.readyState === WebSocket.OPEN && activeSubId) {
      ws.send(JSON.stringify(["CLOSE", activeSubId]));
    }
    ws?.close();
  };

  const scheduleReconnect = (error?: Error) => {
    if (stopped || reconnectTimer !== null) return;
    onStatus?.("closed", error);
    const delay = Math.min(1_000 * 2 ** reconnectAttempt, 15_000);
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    const socket = new WebSocket(wsUrl);
    const subId = `live-${crypto.randomUUID()}`;
    let authEventId: string | null = null;
    let reqSent = false;
    let terminalClose = false;
    ws = socket;
    activeSubId = subId;
    onStatus?.("connecting");

    const sendReq = () => {
      if (
        stopped ||
        reqSent ||
        socket.readyState !== WebSocket.OPEN ||
        ws !== socket
      ) {
        return;
      }
      reqSent = true;
      socket.send(JSON.stringify(["REQ", subId, filter]));
    };

    socket.addEventListener("message", async (message) => {
      const data = parseEnvelope(message.data);
      if (!data || stopped || ws !== socket) return;
      if (data[0] === "AUTH" && typeof data[1] === "string") {
        try {
          const auth = await signNostrEvent(makeAuthEvent(wsUrl, data[1]), {
            requireNip07: true,
          });
          authEventId = auth.id;
          socket.send(JSON.stringify(["AUTH", auth]));
        } catch (error) {
          terminalClose = true;
          onStatus?.(
            "closed",
            error instanceof Error
              ? error
              : new Error("Authentication failed."),
          );
          socket.close();
        }
        return;
      }
      if (data[0] === "OK" && data[1] === authEventId) {
        if (data[2] === true) sendReq();
        else {
          terminalClose = true;
          onStatus?.(
            "closed",
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay authentication failed.",
            ),
          );
          socket.close();
        }
        return;
      }
      if (data[0] === "EVENT" && data[1] === subId && data[2]) {
        onEvent(data[2] as NostrEvent);
      } else if (data[0] === "EOSE" && data[1] === subId) {
        reconnectAttempt = 0;
        onStatus?.("live");
      } else if (data[0] === "CLOSED" && data[1] === subId) {
        terminalClose = true;
        onStatus?.(
          "closed",
          new Error(
            typeof data[2] === "string"
              ? data[2]
              : "The relay closed the subscription.",
          ),
        );
        socket.close();
      }
    });
    socket.addEventListener("error", () => {
      if (!stopped && ws === socket) socket.close();
    });
    socket.addEventListener("close", () => {
      if (ws === socket) {
        ws = null;
        activeSubId = null;
      }
      if (!stopped && !terminalClose) {
        scheduleReconnect(
          new Error("The realtime connection was interrupted."),
        );
      }
    });
  };

  connect();
  return close;
}

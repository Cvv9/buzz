import { publishSessionEvent } from "@/shared/api/relayEventPublisher";
import type { PendingEvent } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";

type RelayClientPublishSession = {
  generation: () => number;
  ownership: () => number;
  pendingEvents: Map<string, PendingEvent>;
  send: (payload: unknown[], generation: number) => Promise<void>;
  reconnect: () => Promise<number>;
  normalizeError: (error: unknown, fallback: string) => Error;
  recoverSocketFailure: (error: unknown, fallback: string) => Error;
};

export type RelayClientPublishEvent = (
  event: RelayEvent,
  timeoutMessage: string,
  sendErrorMessage: string,
  isCurrent?: () => boolean,
) => Promise<RelayEvent>;

/** Bind RelayClient session ownership and recovery callbacks to event publishing. */
export function createRelayClientEventPublisher(
  session: RelayClientPublishSession,
): RelayClientPublishEvent {
  return (event, timeoutMessage, sendErrorMessage, isCurrent) =>
    publishSessionEvent(
      session,
      event,
      timeoutMessage,
      sendErrorMessage,
      isCurrent,
    );
}

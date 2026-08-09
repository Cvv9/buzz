import { verifyEvent } from "nostr-tools";
import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import {
  KIND_IA_ARCHIVED_LIST,
  identityArchiveTemplate,
  parseArchivedIdentitySnapshot,
  type ArchivedIdentitySnapshot,
} from "./identity-archive-policy";

type RelayInformation = { self?: unknown };

async function relaySigner(): Promise<string | null> {
  try {
    const response = await fetch(relayHttpBaseUrl(), {
      headers: { Accept: "application/nostr+json" },
    });
    if (!response.ok) return null;
    const information = (await response.json()) as RelayInformation;
    return typeof information.self === "string" &&
      /^[0-9a-f]{64}$/i.test(information.self)
      ? information.self.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function newestSnapshot(
  events: readonly NostrEvent[],
  relayPubkey: string,
): ArchivedIdentitySnapshot | null {
  return (
    [...events]
      .sort(
        (left, right) =>
          right.created_at - left.created_at || left.id.localeCompare(right.id),
      )
      .flatMap((event) =>
        verifyEvent(event)
          ? [parseArchivedIdentitySnapshot(event, relayPubkey)]
          : [],
      )
      .find(
        (snapshot): snapshot is ArchivedIdentitySnapshot => snapshot !== null,
      ) ?? null
  );
}

/** Read only the signed relay snapshot; invalid/untrusted events fail closed. */
export async function listArchivedIdentitySnapshot(): Promise<ArchivedIdentitySnapshot | null> {
  const signer = await relaySigner();
  if (!signer) return null;
  return newestSnapshot(
    await queryEvents(relayWsUrl(), {
      kinds: [KIND_IA_ARCHIVED_LIST],
      authors: [signer],
      limit: 50,
    }),
    signer,
  );
}

export function subscribeToArchivedIdentitySnapshot(
  onSnapshot: (snapshot: ArchivedIdentitySnapshot) => void,
) {
  let unsubscribe: () => void = () => {};
  let stopped = false;
  void relaySigner().then((signer) => {
    if (!signer || stopped) return;
    unsubscribe = subscribeEvents(
      relayWsUrl(),
      {
        kinds: [KIND_IA_ARCHIVED_LIST],
        authors: [signer],
        since: Math.floor(Date.now() / 1_000),
      },
      (event) => {
        if (!verifyEvent(event)) return;
        const snapshot = parseArchivedIdentitySnapshot(event, signer);
        if (snapshot) onSnapshot(snapshot);
      },
    );
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

export function requestIdentityArchive(input: {
  action: "archive" | "unarchive";
  targetPubkey: string;
  reason?: string;
  replacedBy?: string;
}) {
  return publishEvent(relayWsUrl(), identityArchiveTemplate(input));
}

import { verifyEvent } from "nostr-tools";
import { queryEvents } from "@/shared/lib/nostr-client";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

const KIND_ARCHIVED_IDENTITIES = 13535;

function newestArchiveSnapshot(
  events: Awaited<ReturnType<typeof queryEvents>>,
) {
  const heads = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const coordinate = `${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === "d")?.[1] ?? ""}`;
    const current = heads.get(coordinate);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      heads.set(coordinate, event);
    }
  }
  return heads.values().next().value;
}

/** Fetch the relay-signed archive projection without allowing it to block discovery. */
export async function listArchivedWorkspaceIdentities(): Promise<Set<string>> {
  try {
    const infoResponse = await fetch(relayHttpBaseUrl(), {
      headers: { Accept: "application/nostr+json" },
    });
    if (!infoResponse.ok) return new Set();
    const info = (await infoResponse.json()) as { self?: unknown };
    if (typeof info.self !== "string" || !/^[0-9a-f]{64}$/i.test(info.self)) {
      return new Set();
    }
    const snapshot = newestArchiveSnapshot(
      await queryEvents(relayWsUrl(), {
        kinds: [KIND_ARCHIVED_IDENTITIES],
        authors: [info.self.toLowerCase()],
        limit: 50,
      }),
    );
    if (
      !snapshot ||
      snapshot.kind !== KIND_ARCHIVED_IDENTITIES ||
      snapshot.pubkey.toLowerCase() !== info.self.toLowerCase() ||
      !verifyEvent(snapshot) ||
      snapshot.tags.filter((tag) => tag.length === 1 && tag[0] === "-")
        .length !== 1
    ) {
      return new Set();
    }
    return new Set(
      snapshot.tags
        .filter(
          (tag) =>
            tag[0] === "p" &&
            typeof tag[1] === "string" &&
            /^[0-9a-f]{64}$/i.test(tag[1]),
        )
        .map((tag) => tag[1].toLowerCase()),
    );
  } catch {
    // Archive state is a visibility hint. Fail open if trust cannot be proven.
    return new Set();
  }
}

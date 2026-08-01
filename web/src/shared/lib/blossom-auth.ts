import { signNostrEvent } from "./nostr-signer";

const MEDIA_HASH_PATTERN = /^\/media\/([0-9a-f]{64})(?:\.|$)/;

/**
 * Build a Blossom BUD-01/BUD-11 authorization header for one protected media
 * read. Buzz validates kind:24242 with t=get and either a matching x or server
 * scope before applying relay-membership authorization.
 */
export async function makeBlossomGetAuthHeader(
  source: string,
  options?: { requireDurableSigner?: boolean },
): Promise<string> {
  const url = new URL(source);
  const sha256 = url.pathname.match(MEDIA_HASH_PATTERN)?.[1];
  if (!sha256) throw new Error("Buzz media URL does not contain a valid hash.");

  const now = Math.floor(Date.now() / 1000);
  const event = await signNostrEvent(
    {
      kind: 24242,
      content: "Get Buzz media",
      created_at: now,
      tags: [
        ["t", "get"],
        ["x", sha256],
        ["server", url.host],
        ["expiration", String(now + 300)],
      ],
    },
    { requireNip07: options?.requireDurableSigner },
  );

  return `Nostr ${btoa(JSON.stringify(event))}`;
}

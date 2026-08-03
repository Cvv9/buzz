import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  getBrowserSecretKey,
  hasUnlockedBrowserIdentity,
} from "@/shared/lib/browser-identity";

export type UnsignedNostrEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type SignedNostrEvent = UnsignedNostrEvent & {
  id: string;
  pubkey: string;
  sig: string;
};

type Nip07Provider = {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
};

declare global {
  interface Window {
    nostr?: Nip07Provider;
  }
}

export class Nip07UnavailableError extends Error {
  constructor() {
    super("Create or import a browser identity before joining this workspace.");
    this.name = "Nip07UnavailableError";
  }
}

let ephemeralSecretKey: Uint8Array | null = null;

function getEphemeralSecretKey(): Uint8Array {
  if (!ephemeralSecretKey) {
    ephemeralSecretKey = generateSecretKey();
  }
  return ephemeralSecretKey;
}

export function hasNip07Provider(): boolean {
  return typeof window !== "undefined" && window.nostr != null;
}

export function hasDurableBrowserSigner(): boolean {
  return hasNip07Provider() || hasUnlockedBrowserIdentity();
}

function sameUnsignedEvent(
  expected: UnsignedNostrEvent,
  actual: SignedNostrEvent,
): boolean {
  return (
    actual.kind === expected.kind &&
    actual.created_at === expected.created_at &&
    actual.content === expected.content &&
    JSON.stringify(actual.tags) === JSON.stringify(expected.tags)
  );
}

/**
 * Sign with NIP-07 when available, then the device-bound browser identity,
 * otherwise use a page-lifetime key.
 *
 * The ephemeral fallback preserves anonymous browsing on open relays. Flows
 * that create durable membership set `requireNip07`; the legacy option name is
 * retained for API compatibility but now accepts either durable signer.
 */
export async function signNostrEvent(
  template: Omit<UnsignedNostrEvent, "created_at"> & {
    created_at?: number;
  },
  options?: { requireNip07?: boolean },
): Promise<SignedNostrEvent> {
  const unsigned: UnsignedNostrEvent = {
    ...template,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
  };
  const provider = typeof window === "undefined" ? undefined : window.nostr;

  if (provider) {
    const expectedPubkey = await provider.getPublicKey();
    const signed = await provider.signEvent(unsigned);
    if (
      signed.pubkey !== expectedPubkey ||
      !sameUnsignedEvent(unsigned, signed) ||
      typeof signed.id !== "string" ||
      typeof signed.sig !== "string"
    ) {
      throw new Error("The NIP-07 extension returned an invalid signed event.");
    }
    return signed;
  }

  const browserSecret = await getBrowserSecretKey();
  if (browserSecret) {
    return finalizeEvent(unsigned, browserSecret);
  }

  if (options?.requireNip07) {
    throw new Nip07UnavailableError();
  }

  const secretKey = getEphemeralSecretKey();
  const signed = finalizeEvent(unsigned, secretKey);
  if (signed.pubkey !== getPublicKey(secretKey)) {
    throw new Error("Failed to create the ephemeral browser identity.");
  }
  return signed;
}

/**
 * Encrypt private client state to the signed-in identity using NIP-44 v2.
 *
 * Browser identities hold a device-unlocked secret locally. NIP-07 identities
 * delegate the operation to their extension, so private state never leaves the
 * signer unencrypted. This is shared by the web read-state implementation and
 * deliberately has no ephemeral fallback: an unread marker must never be
 * published under a throwaway identity.
 */
export async function nip44EncryptToSelf(
  pubkey: string,
  plaintext: string,
): Promise<string> {
  const browserSecret = await getBrowserSecretKey();
  if (browserSecret) {
    return nip44.encrypt(
      plaintext,
      nip44.utils.getConversationKey(browserSecret, pubkey),
    );
  }

  const provider = typeof window === "undefined" ? undefined : window.nostr;
  if (provider?.nip44) return provider.nip44.encrypt(pubkey, plaintext);

  throw new Nip07UnavailableError();
}

/** Decrypt NIP-44 state addressed to the signed-in identity. */
export async function nip44DecryptFromSelf(
  pubkey: string,
  ciphertext: string,
): Promise<string> {
  const browserSecret = await getBrowserSecretKey();
  if (browserSecret) {
    return nip44.decrypt(
      ciphertext,
      nip44.utils.getConversationKey(browserSecret, pubkey),
    );
  }

  const provider = typeof window === "undefined" ? undefined : window.nostr;
  if (provider?.nip44) return provider.nip44.decrypt(pubkey, ciphertext);

  throw new Nip07UnavailableError();
}

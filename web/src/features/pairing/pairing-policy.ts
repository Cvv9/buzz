export const KIND_PAIRING = 24134;
export const PAIRING_PROTOCOL_VERSION = 1;
export const PAIRING_SESSION_TIMEOUT_MS = 120_000;
export const PAIRING_MAX_PAYLOAD_BYTES = 65_400;

export type PairingQrPayload = {
  sourcePubkey: string;
  sessionSecret: Uint8Array;
  relayUrl: string;
  version: 1;
};

export type PairingMessage =
  | { type: "offer"; session_id: string; version: 1 }
  | { type: "sas-confirm"; transcript_hash: string }
  | { type: "payload"; payload_type: "nsec"; payload: string }
  | { type: "complete"; success: boolean }
  | {
      type: "abort";
      reason: "sas_mismatch" | "user_denied" | "timeout" | "protocol_error";
    };

function isLowercaseHex(value: string, length: number) {
  return new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function bytesToHex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** WebCrypto rejects SharedArrayBuffer-backed views; own every input first. */
function ownedBytes(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function hexToBytes(value: string) {
  if (!isLowercaseHex(value, 64))
    throw new Error("Expected 32 lowercase hex bytes.");
  const result = new Uint8Array(32);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function assertPairingRelay(value: string) {
  let relay: URL;
  try {
    relay = new URL(value);
  } catch {
    throw new Error("Pairing code contains an invalid relay URL.");
  }
  if (!/^wss?:$/.test(relay.protocol) || !relay.host) {
    throw new Error(
      "Pairing relay must use ws:// or wss:// and include a host.",
    );
  }
  return relay.toString();
}

/** Encode the exact NIP-AB `nostrpair://` bootstrap URI. */
export function encodePairingUri(payload: PairingQrPayload) {
  const sourcePubkey = payload.sourcePubkey.toLowerCase();
  if (!isLowercaseHex(sourcePubkey, 64)) {
    throw new Error(
      "Pairing source pubkey must be 64 lowercase hex characters.",
    );
  }
  if (
    payload.sessionSecret.byteLength !== 32 ||
    payload.sessionSecret.every((byte) => byte === 0)
  ) {
    throw new Error("Pairing session secret must be 32 non-zero random bytes.");
  }
  if (payload.version !== PAIRING_PROTOCOL_VERSION) {
    throw new Error("This browser supports only NIP-AB pairing version 1.");
  }
  const relayUrl = assertPairingRelay(payload.relayUrl);
  return `nostrpair://${sourcePubkey}?secret=${bytesToHex(payload.sessionSecret)}&relay=${encodeURIComponent(relayUrl)}&v=1`;
}

/** Parse a bounded QR/manual pairing string without accepting relaxed variants. */
export function parsePairingUri(uri: string): PairingQrPayload {
  const normalized = uri.trim();
  if (normalized.length > 2_048 || !normalized.startsWith("nostrpair://")) {
    throw new Error(
      "Pairing code must be a nostrpair:// URI no longer than 2048 characters.",
    );
  }
  const withoutScheme = normalized.slice("nostrpair://".length);
  const separator = withoutScheme.indexOf("?");
  if (separator <= 0)
    throw new Error("Pairing code is missing its query parameters.");
  const sourcePubkey = withoutScheme.slice(0, separator);
  if (!isLowercaseHex(sourcePubkey, 64)) {
    throw new Error(
      "Pairing source pubkey must be 64 lowercase hex characters.",
    );
  }
  const parameters = new URLSearchParams(withoutScheme.slice(separator + 1));
  const secret = parameters.get("secret");
  const relayValues = parameters.getAll("relay");
  const version = parameters.get("v") ?? "1";
  if (parameters.getAll("secret").length !== 1 || !secret) {
    throw new Error("Pairing code must contain exactly one session secret.");
  }
  if (relayValues.length !== 1) {
    throw new Error("This browser supports exactly one NIP-AB pairing relay.");
  }
  if (version !== "1") {
    throw new Error("This pairing code requires a newer protocol version.");
  }
  const sessionSecret = hexToBytes(secret);
  if (sessionSecret.every((byte) => byte === 0)) {
    throw new Error("Pairing session secret cannot be all zeroes.");
  }
  return {
    sourcePubkey,
    sessionSecret,
    relayUrl: assertPairingRelay(relayValues[0] ?? ""),
    version: 1,
  };
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    ownedBytes(ikm),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ownedBytes(salt),
      info: ownedBytes(new TextEncoder().encode(info)),
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export function derivePairingSessionId(sessionSecret: Uint8Array) {
  if (sessionSecret.byteLength !== 32)
    throw new Error("Invalid pairing session secret.");
  return hkdf(sessionSecret, new Uint8Array(), "nostr-pair-session-id");
}

export async function derivePairingSas(
  rawEcdh: Uint8Array,
  sessionSecret: Uint8Array,
) {
  if (rawEcdh.byteLength !== 32 || sessionSecret.byteLength !== 32) {
    throw new Error("Invalid NIP-AB ECDH material.");
  }
  const input = await hkdf(rawEcdh, sessionSecret, "nostr-pair-sas-v1");
  const value = new DataView(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  ).getUint32(0, false);
  return { input, code: String(value % 1_000_000).padStart(6, "0") };
}

export async function derivePairingTranscriptHash(input: {
  sessionId: Uint8Array;
  sourcePubkey: string;
  targetPubkey: string;
  sasInput: Uint8Array;
  sessionSecret: Uint8Array;
}) {
  if (
    input.sessionId.byteLength !== 32 ||
    input.sasInput.byteLength !== 32 ||
    input.sessionSecret.byteLength !== 32
  ) {
    throw new Error("Invalid NIP-AB transcript material.");
  }
  const transcript = new Uint8Array(128);
  transcript.set(input.sessionId, 0);
  transcript.set(hexToBytes(input.sourcePubkey), 32);
  transcript.set(hexToBytes(input.targetPubkey), 64);
  transcript.set(input.sasInput, 96);
  return hkdf(transcript, input.sessionSecret, "nostr-pair-transcript-v1");
}

export function pairingHex(value: Uint8Array) {
  return bytesToHex(value);
}

/** Avoid early-exit comparison for session and transcript secrets. */
export function pairingConstantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    const leftByte = left[index] ?? 0;
    const rightByte = right[index] ?? 0;
    mismatch |= leftByte ^ rightByte;
  }
  return mismatch === 0;
}

/** Strictly parse only the payload types the browser can safely import today. */
export function parsePairingMessage(value: unknown): PairingMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "offer":
      return typeof message.session_id === "string" &&
        isLowercaseHex(message.session_id, 64) &&
        message.version === 1 &&
        Object.keys(message).length === 3
        ? { type: "offer", session_id: message.session_id, version: 1 }
        : null;
    case "sas-confirm":
      return typeof message.transcript_hash === "string" &&
        isLowercaseHex(message.transcript_hash, 64) &&
        Object.keys(message).length === 2
        ? { type: "sas-confirm", transcript_hash: message.transcript_hash }
        : null;
    case "payload":
      return message.payload_type === "nsec" &&
        typeof message.payload === "string" &&
        message.payload.startsWith("nsec1") &&
        new TextEncoder().encode(message.payload).byteLength <=
          PAIRING_MAX_PAYLOAD_BYTES &&
        Object.keys(message).length === 3
        ? { type: "payload", payload_type: "nsec", payload: message.payload }
        : null;
    case "complete":
      return typeof message.success === "boolean" &&
        Object.keys(message).length === 2
        ? { type: "complete", success: message.success }
        : null;
    case "abort":
      return (message.reason === "sas_mismatch" ||
        message.reason === "user_denied" ||
        message.reason === "timeout" ||
        message.reason === "protocol_error") &&
        Object.keys(message).length === 2
        ? { type: "abort", reason: message.reason }
        : null;
    default:
      return null;
  }
}

export function pairingEventHasExactRecipient(
  tags: readonly string[][],
  recipientPubkey: string,
) {
  return (
    tags.length === 1 &&
    tags[0]?.length === 2 &&
    tags[0]?.[0] === "p" &&
    tags[0]?.[1] === recipientPubkey
  );
}

export function pairingCapabilities() {
  return {
    crypto: typeof crypto !== "undefined" && Boolean(crypto.subtle),
    camera:
      typeof window !== "undefined" &&
      "BarcodeDetector" in window &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    clipboard:
      typeof navigator !== "undefined" &&
      Boolean(navigator.clipboard?.writeText),
  };
}

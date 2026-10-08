import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_CODE_MAX_ATTEMPTS,
  decodeIdentityPayload,
  desktopCodeMatches,
  encodeIdentityPayload,
  generateDesktopCode,
  encodePairingUri,
  pairingConstantTimeEqual,
  parsePairingMessage,
  parsePairingUri,
} from "../src/features/pairing/pairing-policy.ts";

const SOURCE = "a".repeat(64);
const SECRET = new Uint8Array(32).fill(1);

test("NIP-AB QR URI round-trips only the strict browser-supported form", () => {
  const encoded = encodePairingUri({
    sourcePubkey: SOURCE,
    sessionSecret: SECRET,
    relayUrl: "wss://pair.example/nostr",
    version: 1,
  });
  const decoded = parsePairingUri(encoded);
  assert.equal(decoded.sourcePubkey, SOURCE);
  assert.equal(decoded.relayUrl, "wss://pair.example/nostr");
  assert.deepEqual(decoded.sessionSecret, SECRET);
  assert.throws(
    () => parsePairingUri(encoded.replace("&v=1", "&v=2")),
    /newer protocol/,
  );
  assert.throws(
    () => parsePairingUri(encoded.replace("wss%3A", "https%3A")),
    /ws:\/\/ or wss:\/\//,
  );
});

test("NIP-AB accepts only exact supported transfer messages", () => {
  assert.deepEqual(
    parsePairingMessage({
      type: "offer",
      session_id: "b".repeat(64),
      version: 1,
    }),
    { type: "offer", session_id: "b".repeat(64), version: 1 },
  );
  assert.equal(
    parsePairingMessage({
      type: "payload",
      payload_type: "custom",
      payload: "no",
    }),
    null,
  );
  assert.equal(
    parsePairingMessage({
      type: "offer",
      session_id: "b".repeat(64),
      version: 2,
    }),
    null,
  );
  assert.equal(
    pairingConstantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])),
    true,
  );
  assert.equal(
    pairingConstantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])),
    false,
  );
});

test("NIP-AB identity payload carries the relay for phones and still reads a bare nsec", () => {
  const nsec = `nsec1${"q".repeat(58)}`;
  const encoded = encodeIdentityPayload({
    relayUrl: "https://buzz.example",
    pubkey: "c".repeat(64),
    nsec,
  });
  assert.deepEqual(JSON.parse(encoded), {
    relayUrl: "https://buzz.example",
    pubkey: "c".repeat(64),
    nsec,
  });
  assert.deepEqual(
    parsePairingMessage({
      type: "payload",
      payload_type: "custom",
      payload: encoded,
    }),
    { type: "payload", payload_type: "custom", payload: encoded },
  );
  assert.deepEqual(decodeIdentityPayload("custom", encoded), {
    nsec,
    relayUrl: "https://buzz.example",
    pubkey: "c".repeat(64),
  });
  assert.deepEqual(decodeIdentityPayload("nsec", nsec), {
    nsec,
    relayUrl: null,
    pubkey: null,
  });
  assert.equal(
    parsePairingMessage({
      type: "payload",
      payload_type: "custom",
      payload: JSON.stringify({ relayUrl: "https://buzz.example" }),
    }),
    null,
  );
  assert.throws(() => decodeIdentityPayload("custom", "{}"), /nsec/);
});

test("NIP-AB code-entry extension: offers may advertise it and the source messages parse", () => {
  const offer = {
    type: "offer",
    session_id: "b".repeat(64),
    version: 1,
    confirmation: "desktop-code-v1",
  };
  assert.deepEqual(parsePairingMessage(offer), offer);
  assert.equal(parsePairingMessage({ ...offer, confirmation: 7 }), null);
  assert.equal(parsePairingMessage({ ...offer, extra: "no" }), null);
  assert.deepEqual(parsePairingMessage({ type: "desktop-code" }), {
    type: "desktop-code",
  });
  assert.equal(parsePairingMessage({ type: "desktop-code", code: "1" }), null);
  assert.deepEqual(
    parsePairingMessage({
      type: "code-submit",
      code: "123456",
      request_id: "1",
    }),
    { type: "code-submit", code: "123456", request_id: "1" },
  );
  assert.equal(
    parsePairingMessage({ type: "code-submit", code: "123456" }),
    null,
  );
  assert.deepEqual(
    parsePairingMessage({
      type: "code-rejected",
      request_id: "1",
      remaining_attempts: 4,
    }),
    { type: "code-rejected", request_id: "1", remaining_attempts: 4 },
  );
  assert.equal(DESKTOP_CODE_MAX_ATTEMPTS, 5);
  const code = generateDesktopCode();
  assert.match(code, /^[0-9]{6}$/);
  assert.equal(desktopCodeMatches(code, code), true);
  assert.equal(desktopCodeMatches(code, `${code}0`), false);
  assert.equal(desktopCodeMatches("000000", "000001"), false);
});

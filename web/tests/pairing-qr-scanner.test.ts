import assert from "node:assert/strict";
import test from "node:test";
import { pairingCameraSupported } from "../src/features/pairing/pairing-policy.ts";
import { createPairingQrScanner } from "../src/features/pairing/pairing-qr-scanner.ts";

test("camera QR scanning requires both decoder and user-media capabilities", () => {
  assert.equal(
    pairingCameraSupported({
      barcodeDetector: class {},
      getUserMedia: () => Promise.resolve(),
    }),
    true,
  );
  assert.equal(
    pairingCameraSupported({ barcodeDetector: class {}, getUserMedia: null }),
    false,
  );
  assert.equal(
    pairingCameraSupported({ barcodeDetector: null, getUserMedia: () => {} }),
    false,
  );
});

test("a QR scan stops every camera track before handing the URI to pairing", async () => {
  const stopped: string[] = [];
  const cleared: number[] = [];
  const video = {
    muted: false,
    playsInline: false,
    srcObject: null,
    play: async () => undefined,
  };
  const scanner = createPairingQrScanner({
    clearTimeout: (handle) => {
      cleared.push(handle);
    },
    createDetector: () => ({
      detect: async () => [{ rawValue: "nostrpair://scanned" }],
    }),
    getUserMedia: async () => ({
      getTracks: () => [{ stop: () => stopped.push("camera") }],
    }),
    setTimeout: () => 7,
  });
  let captured: string | null = null;

  await scanner.start(
    video,
    (value) => {
      captured = value;
    },
    (error) => assert.fail(error.message),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(captured, "nostrpair://scanned");
  assert.deepEqual(stopped, ["camera"]);
  assert.equal(video.srcObject, null);
  assert.ok(cleared.length >= 1);
});

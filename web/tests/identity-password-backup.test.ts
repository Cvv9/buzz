import assert from "node:assert/strict";
import test from "node:test";
import {
  readPasswordBackup,
  removePasswordBackup,
  savePasswordBackup,
} from "../src/shared/lib/identity-password-backup.ts";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
  configurable: true,
});
const key = "buzz.web.identity.password-backup.v1";
const identity = {
  id: "primary" as const,
  pubkey: "a".repeat(64),
  displayName: "Test",
  iterations: 310_000,
  salt: new ArrayBuffer(16),
  iv: new ArrayBuffer(12),
  encryptedSecret: new ArrayBuffer(48),
};

test("password backup round-trip excludes device decryption material and supports forgetting", () => {
  savePasswordBackup({
    ...identity,
    ...{ deviceEncryptionKey: "must-not-persist", secret: "must-not-persist" },
  });
  assert.equal(values.get(key)?.includes("must-not-persist"), false);
  assert.deepEqual(readPasswordBackup(), { ...identity, version: 2 });
  removePasswordBackup();
  assert.equal(readPasswordBackup(), null);
});

test("malformed backups and abusive KDF parameters are rejected without deleting evidence", () => {
  savePasswordBackup(identity);
  const original = values.get(key) ?? "";
  for (const patch of [
    { version: 1 },
    { iterations: 0 },
    { iterations: 2_000_000_000 },
    { iterations: 310_000.5 },
    { pubkey: "invalid" },
    { salt: "bad" },
    { iv: "!" },
    { encryptedSecret: "" },
  ]) {
    const raw = JSON.stringify({ ...JSON.parse(original), ...patch });
    values.set(key, raw);
    assert.throws(() => readPasswordBackup(), /could not be read/);
    assert.equal(values.get(key), raw);
  }
});

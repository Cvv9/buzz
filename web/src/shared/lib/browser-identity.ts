import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decode, nsecEncode } from "nostr-tools/nip19";

const DATABASE_NAME = "buzz-web-identity";
const DATABASE_VERSION = 1;
const STORE_NAME = "identity";
const PRIMARY_IDENTITY_KEY = "primary";
const IDENTITY_MARKER_KEY = "buzz.web.identity.present.v1";
const DEVICE_AUTO_UNLOCK_DISABLED_KEY =
  "buzz.web.identity.auto-unlock.disabled.v1";
const PASSWORD_KDF_ITERATIONS = 310_000;
const MIN_PASSWORD_LENGTH = 10;

type StoredBrowserIdentityV1 = {
  id: typeof PRIMARY_IDENTITY_KEY;
  version: 1;
  pubkey: string;
  displayName: string;
  encryptionKey: CryptoKey;
  iv: ArrayBuffer;
  encryptedSecret: ArrayBuffer;
};

type StoredBrowserIdentityV2 = {
  id: typeof PRIMARY_IDENTITY_KEY;
  version: 2;
  pubkey: string;
  displayName: string;
  salt: ArrayBuffer;
  iterations: number;
  iv: ArrayBuffer;
  encryptedSecret: ArrayBuffer;
};

type StoredBrowserIdentityV3 = Omit<StoredBrowserIdentityV2, "version"> & {
  version: 3;
  deviceEncryptionKey: CryptoKey;
  deviceIv: ArrayBuffer;
  deviceEncryptedSecret: ArrayBuffer;
};

type StoredBrowserIdentity =
  | StoredBrowserIdentityV1
  | StoredBrowserIdentityV2
  | StoredBrowserIdentityV3;

export type BrowserIdentity = {
  pubkey: string;
  displayName: string;
};

export type StoredBrowserIdentitySummary = BrowserIdentity & {
  protection: "legacy" | "password";
};

let unlockedSecret: Uint8Array | null = null;
let unlockedIdentity: BrowserIdentity | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open identity storage."));
  });
}

async function readStoredIdentity(): Promise<StoredBrowserIdentity | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction
        .objectStore(STORE_NAME)
        .get(PRIMARY_IDENTITY_KEY);
      request.onsuccess = () =>
        resolve((request.result as StoredBrowserIdentity | undefined) ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read browser identity."));
    });
  } finally {
    database.close();
  }
}

async function writeStoredIdentity(
  identity: StoredBrowserIdentity,
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(identity);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error("Could not save browser identity."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("Saving browser identity was aborted."),
        );
    });
  } finally {
    database.close();
  }
}

async function deleteStoredIdentity(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(PRIMARY_IDENTITY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error("Could not remove browser identity."),
        );
    });
  } finally {
    database.close();
  }
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
}

async function derivePasswordKey(
  password: string,
  salt: ArrayBuffer,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function setUnlockedIdentity(
  secret: Uint8Array,
  identity: BrowserIdentity,
): BrowserIdentity {
  unlockedSecret?.fill(0);
  unlockedSecret = secret.slice();
  unlockedIdentity = identity;
  localStorage.setItem(IDENTITY_MARKER_KEY, identity.pubkey);
  localStorage.removeItem(DEVICE_AUTO_UNLOCK_DISABLED_KEY);
  window.dispatchEvent(new Event("buzz-browser-identity-changed"));
  return identity;
}

function deviceAutoUnlockIsDisabled(): boolean {
  return (
    typeof window !== "undefined" &&
    localStorage.getItem(DEVICE_AUTO_UNLOCK_DISABLED_KEY) === "true"
  );
}

async function createDeviceProtection(secret: Uint8Array): Promise<{
  deviceEncryptionKey: CryptoKey;
  deviceIv: ArrayBuffer;
  deviceEncryptedSecret: ArrayBuffer;
}> {
  const deviceEncryptionKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const deviceIv = copyBuffer(crypto.getRandomValues(new Uint8Array(12)));
  const deviceEncryptedSecret = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: deviceIv },
    deviceEncryptionKey,
    copyBuffer(secret),
  );
  return { deviceEncryptionKey, deviceIv, deviceEncryptedSecret };
}

async function upgradePasswordProtectedIdentity(
  stored: StoredBrowserIdentityV2,
  secret: Uint8Array,
): Promise<void> {
  await writeStoredIdentity({
    ...stored,
    version: 3,
    ...(await createDeviceProtection(secret)),
  });
}

async function persistPasswordProtectedSecret(
  secret: Uint8Array,
  displayName: string,
  password: string,
): Promise<BrowserIdentity> {
  validatePassword(password);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const salt = copyBuffer(saltBytes);
  const iv = copyBuffer(ivBytes);
  const encryptionKey = await derivePasswordKey(
    password,
    salt,
    PASSWORD_KDF_ITERATIONS,
  );
  const encryptedSecret = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    copyBuffer(secret),
  );
  const identity = {
    pubkey: getPublicKey(secret),
    displayName: displayName.trim() || "VarVik member",
  };
  await writeStoredIdentity({
    id: PRIMARY_IDENTITY_KEY,
    version: 3,
    ...identity,
    salt,
    iterations: PASSWORD_KDF_ITERATIONS,
    iv,
    encryptedSecret,
    ...(await createDeviceProtection(secret)),
  });
  return setUnlockedIdentity(secret, identity);
}

export function hasStoredBrowserIdentity(): boolean {
  return (
    typeof window !== "undefined" &&
    localStorage.getItem(IDENTITY_MARKER_KEY) !== null
  );
}

export function hasUnlockedBrowserIdentity(): boolean {
  return unlockedIdentity !== null && unlockedSecret !== null;
}

export function getUnlockedBrowserIdentity(): BrowserIdentity | null {
  return unlockedIdentity;
}

export async function getStoredBrowserIdentity(): Promise<StoredBrowserIdentitySummary | null> {
  const stored = await readStoredIdentity();
  if (!stored) {
    localStorage.removeItem(IDENTITY_MARKER_KEY);
    return null;
  }
  localStorage.setItem(IDENTITY_MARKER_KEY, stored.pubkey);
  return {
    pubkey: stored.pubkey,
    displayName: stored.displayName,
    protection: stored.version === 1 ? "legacy" : "password",
  };
}

export async function unlockBrowserIdentity(
  password: string,
): Promise<BrowserIdentity> {
  const stored = await readStoredIdentity();
  if (!stored) throw new Error("No saved Buzz account was found.");
  if (stored.version !== 2 && stored.version !== 3) {
    throw new Error("Set a password for this saved account before signing in.");
  }
  try {
    const encryptionKey = await derivePasswordKey(
      password,
      stored.salt,
      stored.iterations,
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: stored.iv },
      encryptionKey,
      stored.encryptedSecret,
    );
    const secret = new Uint8Array(decrypted);
    if (getPublicKey(secret) !== stored.pubkey) throw new Error("key mismatch");
    if (stored.version === 2) {
      try {
        await upgradePasswordProtectedIdentity(stored, secret);
      } catch {
        // Keep password recovery available if this browser cannot retain a
        // non-extractable device key. The next password unlock can retry it.
      }
    }
    return setUnlockedIdentity(secret, {
      pubkey: stored.pubkey,
      displayName: stored.displayName,
    });
  } catch {
    throw new Error("Incorrect password. This Buzz account remains locked.");
  }
}

export async function migrateLegacyBrowserIdentity(
  password: string,
): Promise<BrowserIdentity> {
  const stored = await readStoredIdentity();
  if (!stored) throw new Error("No saved Buzz account was found.");
  if (stored.version === 2 || stored.version === 3) {
    return unlockBrowserIdentity(password);
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: stored.iv },
      stored.encryptionKey,
      stored.encryptedSecret,
    );
    const secret = new Uint8Array(decrypted);
    if (getPublicKey(secret) !== stored.pubkey) throw new Error("key mismatch");
    return persistPasswordProtectedSecret(secret, stored.displayName, password);
  } catch (error) {
    if (error instanceof Error && error.message.includes("at least")) {
      throw error;
    }
    throw new Error(
      "This saved account could not be secured. Use its recovery key instead.",
    );
  }
}

/**
 * Restores a saved identity after a normal reload using a key that is bound to
 * this browser profile. Password unlock remains available as the recovery path.
 */
export async function unlockBrowserIdentityForDevice(): Promise<BrowserIdentity | null> {
  if (deviceAutoUnlockIsDisabled()) return null;
  const stored = await readStoredIdentity();
  if (!stored) {
    localStorage.removeItem(IDENTITY_MARKER_KEY);
    return null;
  }
  if (stored.version !== 3) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: stored.deviceIv },
      stored.deviceEncryptionKey,
      stored.deviceEncryptedSecret,
    );
    const secret = new Uint8Array(decrypted);
    if (getPublicKey(secret) !== stored.pubkey) return null;
    return setUnlockedIdentity(secret, {
      pubkey: stored.pubkey,
      displayName: stored.displayName,
    });
  } catch {
    return null;
  }
}

export async function createBrowserIdentity(
  displayName: string,
  password: string,
): Promise<BrowserIdentity> {
  return persistPasswordProtectedSecret(
    generateSecretKey(),
    displayName,
    password,
  );
}

export async function importBrowserIdentity(
  nsec: string,
  displayName: string,
  password: string,
): Promise<BrowserIdentity> {
  const decoded = decode(nsec.trim());
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
    throw new Error("Enter a valid Buzz recovery key beginning with nsec1.");
  }
  return persistPasswordProtectedSecret(decoded.data, displayName, password);
}

export async function getBrowserSecretKey(): Promise<Uint8Array | null> {
  return unlockedSecret?.slice() ?? null;
}

export async function exportBrowserIdentity(): Promise<string> {
  const secret = await getBrowserSecretKey();
  if (!secret) throw new Error("Sign in before revealing the recovery key.");
  return nsecEncode(secret);
}

export function lockBrowserIdentity(): void {
  unlockedSecret?.fill(0);
  unlockedSecret = null;
  unlockedIdentity = null;
  localStorage.setItem(DEVICE_AUTO_UNLOCK_DISABLED_KEY, "true");
  window.dispatchEvent(new Event("buzz-browser-identity-changed"));
}

export async function removeBrowserIdentity(): Promise<void> {
  await deleteStoredIdentity();
  lockBrowserIdentity();
  localStorage.removeItem(IDENTITY_MARKER_KEY);
}

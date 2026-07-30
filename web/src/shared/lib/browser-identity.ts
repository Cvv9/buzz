import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decode, nsecEncode } from "nostr-tools/nip19";

const DATABASE_NAME = "buzz-web-identity";
const DATABASE_VERSION = 1;
const STORE_NAME = "identity";
const PRIMARY_IDENTITY_KEY = "primary";
const IDENTITY_MARKER_KEY = "buzz.web.identity.present.v1";

type StoredBrowserIdentity = {
  id: typeof PRIMARY_IDENTITY_KEY;
  version: 1;
  pubkey: string;
  displayName: string;
  encryptionKey: CryptoKey;
  iv: ArrayBuffer;
  encryptedSecret: ArrayBuffer;
};

export type BrowserIdentity = {
  pubkey: string;
  displayName: string;
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

async function persistSecret(
  secret: Uint8Array,
  displayName: string,
): Promise<BrowserIdentity> {
  const encryptionKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const iv = new Uint8Array(ivBytes.byteLength);
  iv.set(ivBytes);
  const secretBytes = new Uint8Array(secret.byteLength);
  secretBytes.set(secret);
  const encryptedSecret = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer },
    encryptionKey,
    secretBytes.buffer,
  );
  const identity = {
    pubkey: getPublicKey(secret),
    displayName: displayName.trim() || "VarVik member",
  };
  await writeStoredIdentity({
    id: PRIMARY_IDENTITY_KEY,
    version: 1,
    ...identity,
    encryptionKey,
    iv: iv.buffer,
    encryptedSecret,
  });
  unlockedSecret = secret.slice();
  unlockedIdentity = identity;
  localStorage.setItem(IDENTITY_MARKER_KEY, identity.pubkey);
  window.dispatchEvent(new Event("buzz-browser-identity-changed"));
  return identity;
}

export function hasStoredBrowserIdentity(): boolean {
  return (
    typeof window !== "undefined" &&
    localStorage.getItem(IDENTITY_MARKER_KEY) !== null
  );
}

export async function loadBrowserIdentity(): Promise<BrowserIdentity | null> {
  if (unlockedIdentity && unlockedSecret) return unlockedIdentity;
  const stored = await readStoredIdentity();
  if (!stored) {
    localStorage.removeItem(IDENTITY_MARKER_KEY);
    return null;
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: stored.iv },
      stored.encryptionKey,
      stored.encryptedSecret,
    );
    const secret = new Uint8Array(decrypted);
    if (getPublicKey(secret) !== stored.pubkey) {
      throw new Error("Stored identity verification failed.");
    }
    unlockedSecret = secret;
    unlockedIdentity = {
      pubkey: stored.pubkey,
      displayName: stored.displayName,
    };
    localStorage.setItem(IDENTITY_MARKER_KEY, stored.pubkey);
    return unlockedIdentity;
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(
      `This browser could not unlock the saved Buzz identity.${detail}`,
    );
  }
}

export async function createBrowserIdentity(
  displayName: string,
): Promise<BrowserIdentity> {
  return persistSecret(generateSecretKey(), displayName);
}

export async function importBrowserIdentity(
  nsec: string,
  displayName: string,
): Promise<BrowserIdentity> {
  const decoded = decode(nsec.trim());
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
    throw new Error("Enter a valid nsec private key.");
  }
  return persistSecret(decoded.data, displayName);
}

export async function getBrowserSecretKey(): Promise<Uint8Array | null> {
  if (!unlockedSecret) await loadBrowserIdentity();
  return unlockedSecret?.slice() ?? null;
}

export async function exportBrowserIdentity(): Promise<string> {
  const secret = await getBrowserSecretKey();
  if (!secret) throw new Error("No browser identity is available.");
  return nsecEncode(secret);
}

export async function removeBrowserIdentity(): Promise<void> {
  await deleteStoredIdentity();
  unlockedSecret?.fill(0);
  unlockedSecret = null;
  unlockedIdentity = null;
  localStorage.removeItem(IDENTITY_MARKER_KEY);
  window.dispatchEvent(new Event("buzz-browser-identity-changed"));
}

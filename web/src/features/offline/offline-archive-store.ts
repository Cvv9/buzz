import { getBrowserSecretKey } from "@/shared/lib/browser-identity";
import {
  ARCHIVABLE_CHANNEL_KINDS,
  OFFLINE_ARCHIVE_EXPORT_MAX_BYTES,
  OFFLINE_ARCHIVE_MAX_BYTES,
  OFFLINE_ARCHIVE_RECORD_LIMIT,
  archiveChannelId,
  archiveableChannelEvent,
  compareOfflineArchiveNewest,
  isBeforeOfflineCursor,
  offlineArchiveScope,
  type OfflineArchiveCursor,
  type OfflineArchiveEvent,
  type OfflineArchiveScope,
  validateArchivePassphrase,
} from "./offline-archive-policy";

const DATABASE_NAME = "buzz-web-offline-archive";
const DATABASE_VERSION = 1;
const RECORDS_STORE = "records";
const USAGE_STORE = "usage";
const PBKDF2_ITERATIONS = 310_000;

type EncryptedArchiveRecord = {
  key: string;
  scope: string;
  id: string;
  channelId: string;
  createdAt: number;
  kind: number;
  bytes: number;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

type ArchiveUsage = {
  scope: string;
  bytes: number;
  count: number;
};

type ArchiveBackup = {
  version: 1;
  scope: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

function archiveKey(scope: string, id: string) {
  return `${scope}:${id}`;
}

function bytes(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function base64(bytesValue: Uint8Array) {
  let result = "";
  for (const value of bytesValue) result += String.fromCharCode(value);
  return btoa(result);
}

function fromBase64(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function openArchiveDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        const records = database.createObjectStore(RECORDS_STORE, {
          keyPath: "key",
        });
        records.createIndex("scope-created", ["scope", "createdAt", "id"]);
        records.createIndex("scope", "scope");
      }
      if (!database.objectStoreNames.contains(USAGE_STORE)) {
        database.createObjectStore(USAGE_STORE, { keyPath: "scope" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open offline archive."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Offline archive operation failed."),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Offline archive operation aborted."),
      );
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Offline archive request failed."));
  });
}

async function archiveKeyForScope(scope: string): Promise<CryptoKey> {
  const secret = await getBrowserSecretKey();
  if (!secret) {
    throw new Error(
      "Offline archive is available only while this browser identity is unlocked.",
    );
  }
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      bytes(secret),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode("buzz.web.offline-archive.v1"),
        info: new TextEncoder().encode(scope),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    secret.fill(0);
  }
}

async function passphraseKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytes(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function scopeFrom(input: OfflineArchiveScope) {
  return offlineArchiveScope(input);
}

async function browserRemainingBytes() {
  const estimate = await navigator.storage?.estimate?.();
  if (!estimate?.quota) return OFFLINE_ARCHIVE_MAX_BYTES;
  return Math.max(0, estimate.quota - (estimate.usage ?? 0));
}

export type ArchiveWriteResult = {
  archived: number;
  skipped: number;
  quotaReached: boolean;
};

/**
 * Encrypt and persist a batch received by explicit channel subscriptions. The
 * transaction deduplicates by exact event id and honors both our per-scope
 * limit and the browser's reported remaining storage budget.
 */
export async function archiveChannelEvents(
  partition: OfflineArchiveScope,
  events: readonly unknown[],
): Promise<ArchiveWriteResult> {
  const scope = scopeFrom(partition);
  const accepted = events
    .map(archiveableChannelEvent)
    .filter((event): event is OfflineArchiveEvent => event !== null)
    .slice(0, OFFLINE_ARCHIVE_RECORD_LIMIT);
  if (!accepted.length)
    return { archived: 0, skipped: events.length, quotaReached: false };

  const archiveKeyValue = await archiveKeyForScope(scope);
  let remaining = await browserRemainingBytes();
  const database = await openArchiveDatabase();
  try {
    const readTransaction = database.transaction(
      [RECORDS_STORE, USAGE_STORE],
      "readonly",
    );
    const readDone = transactionDone(readTransaction);
    const records = readTransaction.objectStore(RECORDS_STORE);
    const usageStore = readTransaction.objectStore(USAGE_STORE);
    const existingKeys = new Set(
      (await requestResult(
        records.index("scope").getAllKeys(scope),
      )) as string[],
    );
    const usage = ((await requestResult(usageStore.get(scope))) as
      | ArchiveUsage
      | undefined) ?? {
      scope,
      bytes: 0,
      count: 0,
    };
    await readDone;

    const recordsToWrite: EncryptedArchiveRecord[] = [];
    let archived = 0;
    let skipped = events.length - accepted.length;
    let quotaReached = false;
    for (const event of accepted) {
      const key = archiveKey(scope, event.id);
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      const plaintext = new TextEncoder().encode(JSON.stringify(event));
      const estimatedBytes = plaintext.byteLength + 12 + 32;
      if (
        usage.count >= OFFLINE_ARCHIVE_RECORD_LIMIT ||
        usage.bytes + estimatedBytes > OFFLINE_ARCHIVE_MAX_BYTES ||
        estimatedBytes > remaining
      ) {
        skipped += 1;
        quotaReached = true;
        continue;
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        archiveKeyValue,
        plaintext,
      );
      const channelId = archiveChannelId(event);
      if (!channelId) {
        skipped += 1;
        continue;
      }
      const record: EncryptedArchiveRecord = {
        key,
        scope,
        id: event.id,
        channelId,
        createdAt: event.created_at,
        kind: event.kind,
        bytes: estimatedBytes,
        iv: bytes(iv),
        ciphertext,
      };
      recordsToWrite.push(record);
      usage.bytes += estimatedBytes;
      usage.count += 1;
      remaining -= estimatedBytes;
      archived += 1;
    }
    if (recordsToWrite.length) {
      const writeTransaction = database.transaction(
        [RECORDS_STORE, USAGE_STORE],
        "readwrite",
      );
      const writeDone = transactionDone(writeTransaction);
      const writeRecords = writeTransaction.objectStore(RECORDS_STORE);
      for (const record of recordsToWrite) writeRecords.put(record);
      writeTransaction.objectStore(USAGE_STORE).put(usage);
      await writeDone;
    }
    return { archived, skipped, quotaReached };
  } finally {
    database.close();
  }
}

export type OfflineArchivePage = {
  events: OfflineArchiveEvent[];
  nextCursor: OfflineArchiveCursor | null;
};

/** Read/decrypt one bounded archive page after a user unlocked this identity. */
export async function listArchivedChannelEvents(
  partition: OfflineArchiveScope,
  cursor?: OfflineArchiveCursor,
  limit = 50,
): Promise<OfflineArchivePage> {
  const scope = scopeFrom(partition);
  const archiveKeyValue = await archiveKeyForScope(scope);
  const database = await openArchiveDatabase();
  try {
    const transaction = database.transaction(RECORDS_STORE, "readonly");
    const done = transactionDone(transaction);
    const index = transaction.objectStore(RECORDS_STORE).index("scope-created");
    const range = IDBKeyRange.bound(
      [scope, 0, ""],
      [scope, Number.MAX_SAFE_INTEGER, "\uffff"],
    );
    const records = (await requestResult(
      index.getAll(range),
    )) as EncryptedArchiveRecord[];
    await done;
    const events: OfflineArchiveEvent[] = [];
    for (const record of records) {
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: record.iv },
          archiveKeyValue,
          record.ciphertext,
        );
        const event = archiveableChannelEvent(
          JSON.parse(new TextDecoder().decode(plaintext)),
        );
        if (event) events.push(event);
      } catch {
        // Corrupt ciphertext is ignored. It cannot poison the visible archive.
      }
    }
    const ordered = events.sort((left, right) =>
      compareOfflineArchiveNewest(
        { createdAt: left.created_at, id: left.id },
        { createdAt: right.created_at, id: right.id },
      ),
    );
    const bounded = cursor
      ? ordered.filter((event) =>
          isBeforeOfflineCursor(
            { createdAt: event.created_at, id: event.id },
            cursor,
          ),
        )
      : ordered;
    const page = bounded.slice(0, Math.max(1, Math.min(limit, 100)));
    const next =
      bounded.length > page.length ? page[page.length - 1] : undefined;
    return {
      events: page,
      nextCursor: next ? { createdAt: next.created_at, id: next.id } : null,
    };
  } finally {
    database.close();
  }
}

export async function offlineArchiveUsage(partition: OfflineArchiveScope) {
  const scope = scopeFrom(partition);
  const database = await openArchiveDatabase();
  try {
    const transaction = database.transaction(USAGE_STORE, "readonly");
    const done = transactionDone(transaction);
    const usage = (await requestResult(
      transaction.objectStore(USAGE_STORE).get(scope),
    )) as ArchiveUsage | undefined;
    await done;
    return usage ?? { scope, bytes: 0, count: 0 };
  } finally {
    database.close();
  }
}

/** Delete only this relay + identity partition, never another community's cache. */
export async function clearOfflineArchive(partition: OfflineArchiveScope) {
  const scope = scopeFrom(partition);
  const database = await openArchiveDatabase();
  try {
    const transaction = database.transaction(
      [RECORDS_STORE, USAGE_STORE],
      "readwrite",
    );
    const done = transactionDone(transaction);
    const records = transaction.objectStore(RECORDS_STORE);
    const index = records.index("scope");
    const keys = (await requestResult(
      index.getAllKeys(scope),
    )) as IDBValidKey[];
    for (const key of keys) records.delete(key);
    transaction.objectStore(USAGE_STORE).delete(scope);
    await done;
  } finally {
    database.close();
  }
}

/**
 * Re-encrypt a bounded archive export with a user-entered passphrase. The
 * browser identity's at-rest key is never exported and the plaintext exists
 * only inside this explicit gesture path.
 */
export async function exportOfflineArchive(
  partition: OfflineArchiveScope,
  passphrase: string,
) {
  validateArchivePassphrase(passphrase);
  const scope = scopeFrom(partition);
  const events: OfflineArchiveEvent[] = [];
  let cursor: OfflineArchiveCursor | undefined;
  do {
    const page = await listArchivedChannelEvents(partition, cursor, 100);
    events.push(...page.events);
    cursor = page.nextCursor ?? undefined;
    if (events.length > OFFLINE_ARCHIVE_RECORD_LIMIT) {
      throw new Error(
        "Archive export exceeds the supported local record limit.",
      );
    }
  } while (cursor);
  const serialized = JSON.stringify({ version: 1, scope, events });
  const plaintext = new TextEncoder().encode(serialized);
  if (plaintext.byteLength > OFFLINE_ARCHIVE_EXPORT_MAX_BYTES) {
    throw new Error(
      "Archive export is limited to 10 MiB. Clear or narrow the local archive first.",
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passphraseKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return JSON.stringify({
    version: 1,
    scope,
    salt: base64(salt),
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
  } satisfies ArchiveBackup);
}

/** Import only an archive intended for the currently unlocked relay + identity. */
export async function importOfflineArchive(
  partition: OfflineArchiveScope,
  passphrase: string,
  serialized: string,
) {
  validateArchivePassphrase(passphrase);
  const scope = scopeFrom(partition);
  let backup: ArchiveBackup;
  try {
    backup = JSON.parse(serialized) as ArchiveBackup;
  } catch {
    throw new Error("The selected archive backup is not valid JSON.");
  }
  if (
    backup.version !== 1 ||
    backup.scope !== scope ||
    typeof backup.salt !== "string" ||
    typeof backup.iv !== "string" ||
    typeof backup.ciphertext !== "string"
  ) {
    throw new Error(
      "This encrypted archive belongs to a different identity or relay.",
    );
  }
  try {
    const key = await passphraseKey(passphrase, fromBase64(backup.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(backup.iv) },
      key,
      bytes(fromBase64(backup.ciphertext)),
    );
    const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as {
      version?: unknown;
      scope?: unknown;
      events?: unknown;
    };
    if (
      decoded.version !== 1 ||
      decoded.scope !== scope ||
      !Array.isArray(decoded.events)
    ) {
      throw new Error("Archive backup contains an invalid payload.");
    }
    return archiveChannelEvents(partition, decoded.events);
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalid payload"))
      throw error;
    throw new Error("Wrong archive passphrase or damaged encrypted backup.");
  }
}

export function archiveSubscriptionKinds() {
  return [...ARCHIVABLE_CHANNEL_KINDS];
}

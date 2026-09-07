const BACKUP_KEY = "buzz.web.identity.password-backup.v1";

/** Portable password-encrypted identity, without a device decryption key. */
export type PasswordIdentity = {
  id: "primary";
  version: 2;
  pubkey: string;
  displayName: string;
  salt: ArrayBuffer;
  iterations: number;
  iv: ArrayBuffer;
  encryptedSecret: ArrayBuffer;
};

function encode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function decode(value: unknown, length: number): ArrayBuffer {
  if (typeof value !== "string" || value.length > 256)
    throw new Error("Invalid backup");
  const bytes = Uint8Array.from(atob(value), (character) =>
    character.charCodeAt(0),
  );
  if (bytes.length !== length) throw new Error("Invalid backup");
  return bytes.buffer;
}

/** Save only password-encrypted material, never the device key or plaintext key. */
export function savePasswordBackup(
  identity: Omit<PasswordIdentity, "version">,
): void {
  localStorage.setItem(
    BACKUP_KEY,
    JSON.stringify({
      id: "primary",
      version: 2,
      pubkey: identity.pubkey,
      displayName: identity.displayName,
      iterations: identity.iterations,
      salt: encode(identity.salt),
      iv: encode(identity.iv),
      encryptedSecret: encode(identity.encryptedSecret),
    }),
  );
}

/** Recover the existing password unlock when IndexedDB alone has been lost. */
export function readPasswordBackup(): PasswordIdentity | null {
  const raw = localStorage.getItem(BACKUP_KEY);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value.id !== "primary" ||
      value.version !== 2 ||
      typeof value.pubkey !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.pubkey) ||
      typeof value.displayName !== "string" ||
      !Number.isInteger(value.iterations) ||
      value.iterations < 100_000 ||
      value.iterations > 1_000_000
    ) {
      throw new Error("Invalid backup");
    }
    return {
      id: "primary",
      version: 2,
      pubkey: value.pubkey,
      displayName: value.displayName,
      iterations: value.iterations,
      salt: decode(value.salt, 16),
      iv: decode(value.iv, 12),
      encryptedSecret: decode(value.encryptedSecret, 48),
    };
  } catch {
    throw new Error(
      "Your saved password backup could not be read. Your recovery key is needed to restore this account.",
    );
  }
}

/** Remove the fallback together with an explicitly forgotten account. */
export function removePasswordBackup(): void {
  localStorage.removeItem(BACKUP_KEY);
}

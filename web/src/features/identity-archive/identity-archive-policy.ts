export const KIND_IA_ARCHIVE_REQUEST = 9035;
export const KIND_IA_UNARCHIVE_REQUEST = 9036;
export const KIND_IA_ARCHIVED_LIST = 13535;

export type ArchivedIdentitySnapshot = {
  archived: Set<string>;
  createdAt: number;
  eventId: string;
};

function isHexPubkey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function normalizeArchivePubkey(value: string, label = "Identity") {
  const normalized = value.trim().toLowerCase();
  if (!isHexPubkey(normalized))
    throw new Error(`${label} must be a 64-character hex pubkey.`);
  return normalized;
}

export function archiveReason(value?: string) {
  const normalized = value?.trim() ?? "";
  if (new TextEncoder().encode(normalized).byteLength > 64) {
    throw new Error("Archive reason cannot exceed 64 UTF-8 bytes.");
  }
  if (
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      );
    })
  ) {
    throw new Error("Archive reason cannot contain control characters.");
  }
  return normalized;
}

/** Build a protected NIP-IA request. OA owner authorization is intentionally absent in browser. */
export function identityArchiveTemplate(input: {
  action: "archive" | "unarchive";
  targetPubkey: string;
  reason?: string;
  replacedBy?: string;
}) {
  const targetPubkey = normalizeArchivePubkey(input.targetPubkey);
  const reason = archiveReason(input.reason);
  if (input.action === "unarchive" && input.replacedBy) {
    throw new Error("Unarchive requests cannot carry replaced-by.");
  }
  const replacedBy = input.replacedBy
    ? normalizeArchivePubkey(input.replacedBy, "Replacement identity")
    : null;
  if (replacedBy === targetPubkey)
    throw new Error("Replacement identity must differ from the target.");
  return {
    kind:
      input.action === "archive"
        ? KIND_IA_ARCHIVE_REQUEST
        : KIND_IA_UNARCHIVE_REQUEST,
    content: "",
    tags: [
      ["-"],
      ["p", targetPubkey],
      ...(reason ? [["reason", reason]] : []),
      ...(replacedBy ? [["replaced-by", replacedBy]] : []),
    ],
  };
}

/** Validate a relay-signed snapshot before it can affect presentation. */
export function parseArchivedIdentitySnapshot(
  event: {
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
  },
  relayPubkey: string,
): ArchivedIdentitySnapshot | null {
  if (
    event.kind !== KIND_IA_ARCHIVED_LIST ||
    event.content !== "" ||
    event.pubkey.toLowerCase() !== relayPubkey.toLowerCase() ||
    !isHexPubkey(event.pubkey) ||
    !Number.isInteger(event.created_at) ||
    event.created_at < 0
  )
    return null;
  const protectedTags = event.tags.filter(
    (tag) => tag.length === 1 && tag[0] === "-",
  );
  if (protectedTags.length !== 1) return null;
  const archived = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === "-") continue;
    if (tag.length !== 2 || tag[0] !== "p" || !isHexPubkey(tag[1])) return null;
    archived.add(tag[1].toLowerCase());
  }
  return { archived, createdAt: event.created_at, eventId: event.id };
}

/** Archive state folds discovery for other viewers, never for the archived self. */
export function shouldFoldArchivedIdentity(
  candidatePubkey: string,
  selfPubkey: string | undefined,
  archived: ReadonlySet<string>,
) {
  const candidate = candidatePubkey.toLowerCase();
  return candidate !== selfPubkey?.toLowerCase() && archived.has(candidate);
}

export function canManageIdentityArchive(args: {
  targetPubkey: string;
  viewerPubkey?: string;
  communityRole?: string;
}) {
  const target = args.targetPubkey.toLowerCase();
  const viewer = args.viewerPubkey?.toLowerCase();
  return (
    target === viewer ||
    args.communityRole === "owner" ||
    args.communityRole === "admin"
  );
}

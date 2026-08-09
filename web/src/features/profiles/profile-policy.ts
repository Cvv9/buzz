export type ProfileFields = {
  name: string;
  picture: string;
  about: string;
};

export type ReplaceableHead = {
  id: string;
  created_at: number;
};

/** NIP-01/NIP-16 replacement order: timestamp, then lowest event id. */
export function isNewerReplaceableHead(
  candidate: ReplaceableHead,
  current: ReplaceableHead,
): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse an interoperable kind 0 JSON object without trusting malformed input. */
export function parseProfileContent(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Preserve fields the browser does not control when updating a NIP-01 profile.
 * Empty picture/about values are an intentional clear, while unrelated values
 * such as nip05, website, proof, and vendor extensions remain untouched.
 */
export function mergeProfileContent(
  existingContent: string,
  draft: ProfileFields,
): Record<string, unknown> {
  const name = draft.name.trim();
  if (!name) throw new Error("A display name is required.");
  const next: Record<string, unknown> = {
    ...parseProfileContent(existingContent),
    display_name: name,
    name,
  };
  const picture = draft.picture.trim();
  const about = draft.about.trim();
  if (picture) next.picture = picture;
  else delete next.picture;
  if (about) next.about = about;
  else delete next.about;
  return next;
}

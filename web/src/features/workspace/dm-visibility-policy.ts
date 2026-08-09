export type DmVisibilityEvent = {
  kind: number;
  tags: string[][];
};

function normalizedPubkey(pubkey: string) {
  return pubkey.trim().toLowerCase();
}

function isPubkey(value: string) {
  return /^[0-9a-f]{64}$/i.test(value);
}

/** Channel ids are UUIDs, not arbitrary 36-character strings containing hyphens. */
export function isWorkspaceChannelId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function tagValues(event: DmVisibilityEvent, name: string) {
  return event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1] as string);
}

/** Accept an entire relay-authored snapshot only when it belongs to this viewer. */
export function parseDmVisibilitySnapshot(
  event: DmVisibilityEvent,
  viewerPubkey: string,
): Set<string> | null {
  const viewer = normalizedPubkey(viewerPubkey);
  if (event.kind !== 30622 || !isPubkey(viewer)) return null;
  const dTags = tagValues(event, "d").map(normalizedPubkey);
  const pTags = tagValues(event, "p").map(normalizedPubkey);
  if (
    dTags.length !== 1 ||
    pTags.length !== 1 ||
    dTags[0] !== viewer ||
    pTags[0] !== viewer
  ) {
    return null;
  }
  const hidden = tagValues(event, "h");
  if (!hidden.every(isWorkspaceChannelId)) {
    return null;
  }
  return new Set(hidden.map((channelId) => channelId.toLowerCase()));
}

// Seeding policy for the workspace read-state store.
//
// A first web visit must not replay a community's entire pre-existing history
// as unread, so absent-marker channels are seeded forward to their newest
// already-present message. But that seeding may only happen on the genuine
// first visit for an identity: once the local store exists, messages that
// arrive afterwards for a never-read channel must stay unread rather than being
// silently seeded past on the next mount.

/**
 * Decide the read-state marker to seed for a channel that has no marker yet.
 *
 * @param {{
 *   channelEvents: readonly { created_at: number; pubkey: string }[];
 *   pubkey: string;
 *   seededAt: number;
 *   storeExisted: boolean;
 * }} args
 * @returns {number | null} the timestamp to seed, or null to leave the channel
 *   unseeded (so its external messages remain unread).
 */
export function seedMarkerForAbsentChannel({
  channelEvents,
  pubkey,
  seededAt,
  storeExisted,
}) {
  // Subsequent mounts never seed: an absent marker now means the identity has
  // never read the channel, and anything that arrived after the store was
  // created must surface as unread.
  if (storeExisted) return null;
  const normalizedPubkey = pubkey.toLowerCase();
  let newestSeed = null;
  for (const event of channelEvents) {
    // Only external messages define the "already there" history horizon.
    if (event.pubkey.toLowerCase() === normalizedPubkey) continue;
    // Never seed past the horizon captured when the store was first created.
    if (event.created_at > seededAt) continue;
    if (newestSeed === null || event.created_at > newestSeed) {
      newestSeed = event.created_at;
    }
  }
  return newestSeed;
}

/**
 * Resolve the seed horizon for a persisted store, stamping legacy stores that
 * were written before the field existed.
 *
 * @param {unknown} storedSeededAt the raw value read from the store, if any.
 * @param {number} now epoch-seconds fallback for legacy or missing values.
 * @returns {{ seededAt: number; needsStamp: boolean }}
 */
export function resolveSeedHorizon(storedSeededAt, now) {
  if (
    typeof storedSeededAt === "number" &&
    Number.isInteger(storedSeededAt) &&
    storedSeededAt >= 0
  ) {
    return { seededAt: storedSeededAt, needsStamp: false };
  }
  return { seededAt: now, needsStamp: true };
}

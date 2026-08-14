/**
 * Presentation logic for the Slack-style collapsed thread summary bar that
 * replaces the old inline thread expansion. Kept pure and dependency-free so it
 * can be unit tested without React or the full message model.
 */

/** Minimal shape needed to summarize a thread's replies. */
export type ThreadReplyLike = {
  pubkey: string;
  created_at: number;
};

/**
 * Distinct replier pubkeys in reply order, capped at `max`. Replies are the
 * sole input, so the root author only appears when they authored one of the
 * replies (i.e. "excluded unless they replied" falls out naturally — a
 * self-reply is a genuine reply and is kept).
 */
export function selectReplierPubkeys(
  replies: readonly ThreadReplyLike[],
  max = 3,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const reply of replies) {
    if (seen.has(reply.pubkey)) continue;
    seen.add(reply.pubkey);
    result.push(reply.pubkey);
    if (result.length >= max) break;
  }
  return result;
}

/**
 * Unix timestamp (seconds) of the most recent reply, or `null` when there are
 * no replies. Does not assume the replies are pre-sorted.
 */
export function lastReplyTimestamp(
  replies: readonly ThreadReplyLike[],
): number | null {
  let latest: number | null = null;
  for (const reply of replies) {
    if (latest === null || reply.created_at > latest) latest = reply.created_at;
  }
  return latest;
}

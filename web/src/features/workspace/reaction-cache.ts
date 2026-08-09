import type { ReactionSummary } from "./workspace-api";

export type WorkspaceReactionMap = Map<string, ReactionSummary[]>;

function cloneSummary(summary: ReactionSummary): ReactionSummary {
  return {
    ...summary,
    authors: [...summary.authors],
    reactionEventIdsByAuthor: { ...summary.reactionEventIdsByAuthor },
  };
}

/** Return a structurally new cache value so optimistic updates stay isolated. */
export function cloneWorkspaceReactions(
  reactions: WorkspaceReactionMap,
): WorkspaceReactionMap {
  return new Map(
    [...reactions.entries()].map(([messageId, summaries]) => [
      messageId,
      summaries.map(cloneSummary),
    ]),
  );
}

/**
 * Apply the user's local toggle immediately. A synthetic entry deliberately
 * has no event id: an immediate second click will query the relay after the
 * queued add has settled and delete the authoritative event.
 */
export function applyOptimisticReactionToggle(
  reactions: WorkspaceReactionMap,
  {
    messageId,
    emoji,
    emojiUrl,
    ownPubkey,
    remove,
  }: {
    messageId: string;
    emoji: string;
    emojiUrl?: string;
    ownPubkey: string;
    remove: boolean;
  },
): WorkspaceReactionMap {
  const next = cloneWorkspaceReactions(reactions);
  const summaries = next.get(messageId) ?? [];
  const current = summaries.find((summary) => summary.emoji === emoji);

  if (remove) {
    if (!current) return next;
    current.authors = current.authors.filter((author) => author !== ownPubkey);
    delete current.reactionEventIdsByAuthor[ownPubkey];
    const retained = summaries.filter((summary) => summary.authors.length > 0);
    if (retained.length === 0) next.delete(messageId);
    else next.set(messageId, retained);
    return next;
  }

  if (current) {
    if (!current.authors.includes(ownPubkey)) current.authors.push(ownPubkey);
    return next;
  }

  next.set(messageId, [
    ...summaries,
    {
      eventId: messageId,
      emoji,
      ...(emojiUrl ? { emojiUrl } : {}),
      authors: [ownPubkey],
      reactionEventIdsByAuthor: {},
    },
  ]);
  return next;
}

export const KIND_FORUM_POST = 45001;
export const KIND_FORUM_VOTE = 45002;
export const KIND_FORUM_COMMENT = 45003;
export const KIND_DELETION = 5;
export const KIND_NIP29_DELETE = 9005;

export type ForumEvent = {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
};

export type ForumPostProjection = ForumEvent & {
  channelId: string;
  commentCount: number;
  score: number;
  voterCount: number;
};

export type ForumCommentProjection = ForumEvent & {
  channelId: string;
  rootEventId: string;
  parentEventId: string;
  score: number;
  voterCount: number;
};

function tagValue(event: ForumEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function targetId(event: ForumEvent): string | undefined {
  return event.tags.find((tag) => tag[0] === "e")?.[1];
}

function isNewer(
  candidate: Pick<ForumEvent, "created_at" | "id">,
  current: Pick<ForumEvent, "created_at" | "id"> | undefined,
) {
  return (
    !current ||
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}

/** Return an event's channel only when it has the canonical NIP-29 `h` tag. */
export function forumChannelId(event: ForumEvent): string | null {
  const channelId = tagValue(event, "h")?.trim();
  return channelId || null;
}

/** Resolve the NIP-10 root and immediate parent for a forum comment. */
export function forumCommentReferences(event: ForumEvent): {
  rootEventId: string | null;
  parentEventId: string | null;
} {
  const references = event.tags.filter(
    (tag) => tag[0] === "e" && typeof tag[1] === "string" && tag[1],
  );
  const root = references.find((tag) => tag[3] === "root")?.[1];
  const reply = references.find((tag) => tag[3] === "reply")?.[1];
  if (root) return { rootEventId: root, parentEventId: reply ?? root };
  if (reply) return { rootEventId: reply, parentEventId: reply };
  return { rootEventId: null, parentEventId: null };
}

export function forumDeletionTarget(event: ForumEvent): string | null {
  if (event.kind !== KIND_DELETION && event.kind !== KIND_NIP29_DELETE) {
    return null;
  }
  return targetId(event) ?? null;
}

function activeForumEvents(
  events: readonly ForumEvent[],
  channelId: string,
): ForumEvent[] {
  const deleted = new Set(
    events
      .map(forumDeletionTarget)
      .filter((value): value is string => value !== null),
  );
  return events.filter(
    (event) => forumChannelId(event) === channelId && !deleted.has(event.id),
  );
}

function voteTotals(events: readonly ForumEvent[]) {
  const latestByTargetAndAuthor = new Map<string, ForumEvent>();
  for (const event of events) {
    if (event.kind !== KIND_FORUM_VOTE) continue;
    const target = targetId(event);
    if (!target || (event.content !== "+" && event.content !== "-")) continue;
    const key = `${target}:${event.pubkey.toLowerCase()}`;
    const current = latestByTargetAndAuthor.get(key);
    if (isNewer(event, current)) latestByTargetAndAuthor.set(key, event);
  }
  const totals = new Map<string, { score: number; voterCount: number }>();
  for (const [key, vote] of latestByTargetAndAuthor) {
    const target = key.slice(0, key.lastIndexOf(":"));
    const current = totals.get(target) ?? { score: 0, voterCount: 0 };
    current.score += vote.content === "+" ? 1 : -1;
    current.voterCount += 1;
    totals.set(target, current);
  }
  return totals;
}

/**
 * Materialize a channel's forum posts from explicit event kinds. Deletions and
 * repeat votes are resolved before post/comment counts reach the UI.
 */
export function projectForumPosts(
  channelId: string,
  events: readonly ForumEvent[],
): ForumPostProjection[] {
  const active = activeForumEvents(events, channelId);
  const commentsByRoot = new Map<string, number>();
  for (const event of active) {
    if (event.kind !== KIND_FORUM_COMMENT) continue;
    const root = forumCommentReferences(event).rootEventId;
    if (root) commentsByRoot.set(root, (commentsByRoot.get(root) ?? 0) + 1);
  }
  const votes = voteTotals(active);
  return active
    .filter((event) => event.kind === KIND_FORUM_POST)
    .map((event) => {
      const total = votes.get(event.id) ?? { score: 0, voterCount: 0 };
      return {
        ...event,
        channelId,
        commentCount: commentsByRoot.get(event.id) ?? 0,
        score: total.score,
        voterCount: total.voterCount,
      };
    })
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    );
}

/** Materialize one thread, preserving NIP-10 nesting references for the UI. */
export function projectForumThread(
  channelId: string,
  postId: string,
  events: readonly ForumEvent[],
): { post: ForumPostProjection | null; comments: ForumCommentProjection[] } {
  const posts = projectForumPosts(channelId, events);
  const post = posts.find((candidate) => candidate.id === postId) ?? null;
  const active = activeForumEvents(events, channelId);
  const votes = voteTotals(active);
  const comments = active
    .filter((event) => event.kind === KIND_FORUM_COMMENT)
    .flatMap((event): ForumCommentProjection[] => {
      const { rootEventId, parentEventId } = forumCommentReferences(event);
      if (rootEventId !== postId || !parentEventId) return [];
      const total = votes.get(event.id) ?? { score: 0, voterCount: 0 };
      return [
        {
          ...event,
          channelId,
          rootEventId,
          parentEventId,
          score: total.score,
          voterCount: total.voterCount,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.created_at - right.created_at || left.id.localeCompare(right.id),
    );
  return { post, comments };
}

/** Validate the exact client-side preconditions that the relay will enforce. */
export function assertForumWrite(channelId: string, content: string): string {
  const normalizedChannelId = channelId.trim();
  const normalizedContent = content.trim();
  if (!normalizedChannelId) throw new Error("A forum channel is required.");
  if (!normalizedContent) throw new Error("Post content is required.");
  if (new TextEncoder().encode(normalizedContent).byteLength > 64 * 1024) {
    throw new Error("Forum content cannot exceed 64 KiB.");
  }
  return normalizedContent;
}

export function assertForumTarget(eventId: string): string {
  const normalized = eventId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Forum actions require a valid event id.");
  }
  return normalized;
}

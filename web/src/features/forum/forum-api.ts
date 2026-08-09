import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  assertForumTarget,
  assertForumWrite,
  KIND_DELETION,
  KIND_FORUM_COMMENT,
  KIND_FORUM_POST,
  KIND_FORUM_VOTE,
  KIND_NIP29_DELETE,
  projectForumPosts,
  projectForumThread,
  type ForumCommentProjection,
  type ForumEvent,
  type ForumPostProjection,
} from "./forum-policy";

export {
  KIND_FORUM_COMMENT,
  KIND_FORUM_POST,
  KIND_FORUM_VOTE,
  type ForumCommentProjection,
  type ForumPostProjection,
};

const FORUM_PAGE_SIZE = 25;
const FORUM_LIVE_KINDS = [
  KIND_FORUM_POST,
  KIND_FORUM_VOTE,
  KIND_FORUM_COMMENT,
  KIND_DELETION,
  KIND_NIP29_DELETE,
];

export type ForumPostPage = {
  posts: ForumPostProjection[];
  nextBefore: number | null;
};

export type ForumThread = {
  post: ForumPostProjection | null;
  comments: ForumCommentProjection[];
};

function asForumEvent(event: NostrEvent): ForumEvent {
  return event;
}

function queryForumEvents(
  channelId: string,
  filter: {
    kinds: number[];
    ids?: string[];
    until?: number;
    limit: number;
    "#e"?: string[];
  },
) {
  return queryEvents(relayWsUrl(), {
    ...filter,
    "#h": [channelId],
  });
}

/** Fetch a cursor-bounded post page and the events needed for visible counts. */
export async function listForumPosts(
  channelId: string,
  before?: number,
): Promise<ForumPostPage> {
  const posts = await queryForumEvents(channelId, {
    kinds: [KIND_FORUM_POST],
    until: before,
    limit: FORUM_PAGE_SIZE + 1,
  });
  const orderedPosts = posts.sort(
    (left, right) =>
      right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
  const visiblePosts = orderedPosts.slice(0, FORUM_PAGE_SIZE);
  const postIds = visiblePosts.map((post) => post.id);
  if (!postIds.length) return { posts: [], nextBefore: null };
  const [repliesAndVotes, deletions] = await Promise.all([
    queryForumEvents(channelId, {
      kinds: [KIND_FORUM_COMMENT, KIND_FORUM_VOTE],
      "#e": postIds,
      limit: 500,
    }),
    queryForumEvents(channelId, {
      kinds: [KIND_DELETION, KIND_NIP29_DELETE],
      limit: 500,
    }),
  ]);
  const events = [...visiblePosts, ...repliesAndVotes, ...deletions].map(
    asForumEvent,
  );
  return {
    posts: projectForumPosts(channelId, events),
    nextBefore:
      orderedPosts.length > FORUM_PAGE_SIZE
        ? (visiblePosts[visiblePosts.length - 1]?.created_at ?? null)
        : null,
  };
}

/** Fetch a complete, bounded post thread using an explicit `h` and root `e`. */
export async function getForumThread(
  channelId: string,
  postId: string,
): Promise<ForumThread> {
  const targetId = assertForumTarget(postId);
  const [postEvents, comments, topLevelVotes, deletions] = await Promise.all([
    queryForumEvents(channelId, {
      kinds: [KIND_FORUM_POST],
      ids: [targetId],
      limit: 1,
    }),
    queryForumEvents(channelId, {
      kinds: [KIND_FORUM_COMMENT],
      "#e": [targetId],
      limit: 500,
    }),
    queryForumEvents(channelId, {
      kinds: [KIND_FORUM_VOTE],
      "#e": [targetId],
      limit: 500,
    }),
    queryForumEvents(channelId, {
      kinds: [KIND_DELETION, KIND_NIP29_DELETE],
      limit: 500,
    }),
  ]);
  const commentIds = comments.map((comment) => comment.id);
  const commentVotes = commentIds.length
    ? await queryForumEvents(channelId, {
        kinds: [KIND_FORUM_VOTE],
        "#e": commentIds,
        limit: 500,
      })
    : [];
  return projectForumThread(channelId, targetId, [
    ...postEvents,
    ...comments,
    ...topLevelVotes,
    ...commentVotes,
    ...deletions,
  ]);
}

function mentions(mentionPubkeys: string[]): string[][] {
  return [...new Set(mentionPubkeys.map((pubkey) => pubkey.toLowerCase()))]
    .filter((pubkey) => /^[0-9a-f]{64}$/.test(pubkey))
    .map((pubkey) => ["p", pubkey]);
}

export function publishForumPost(
  channelId: string,
  content: string,
  mentionPubkeys: string[] = [],
  mediaTags: string[][] = [],
) {
  const normalizedContent = assertForumWrite(channelId, content);
  return publishEvent(relayWsUrl(), {
    kind: KIND_FORUM_POST,
    content: normalizedContent,
    tags: [["h", channelId.trim()], ...mentions(mentionPubkeys), ...mediaTags],
  });
}

export function publishForumComment(input: {
  channelId: string;
  content: string;
  rootEventId: string;
  parentEventId?: string;
  mentionPubkeys?: string[];
  mediaTags?: string[][];
}) {
  const content = assertForumWrite(input.channelId, input.content);
  const rootEventId = assertForumTarget(input.rootEventId);
  const parentEventId = assertForumTarget(input.parentEventId ?? rootEventId);
  const threadTags =
    parentEventId === rootEventId
      ? [["e", rootEventId, "", "reply"]]
      : [
          ["e", rootEventId, "", "root"],
          ["e", parentEventId, "", "reply"],
        ];
  return publishEvent(relayWsUrl(), {
    kind: KIND_FORUM_COMMENT,
    content,
    tags: [
      ["h", input.channelId.trim()],
      ...threadTags,
      ...mentions(input.mentionPubkeys ?? []),
      ...(input.mediaTags ?? []),
    ],
  });
}

/** Vote events are channel-scoped and target only a forum post/comment. */
export function publishForumVote(
  channelId: string,
  eventId: string,
  direction: "+" | "-",
) {
  const normalizedChannelId = channelId.trim();
  if (!normalizedChannelId) throw new Error("A forum channel is required.");
  return publishEvent(relayWsUrl(), {
    kind: KIND_FORUM_VOTE,
    content: direction,
    tags: [
      ["h", normalizedChannelId],
      ["e", assertForumTarget(eventId)],
    ],
  });
}

/** Use NIP-29 delete so the relay can enforce forum author/moderator policy. */
export function deleteForumEvent(channelId: string, eventId: string) {
  const normalizedChannelId = channelId.trim();
  if (!normalizedChannelId) throw new Error("A forum channel is required.");
  return publishEvent(relayWsUrl(), {
    kind: KIND_NIP29_DELETE,
    content: "",
    tags: [
      ["h", normalizedChannelId],
      ["e", assertForumTarget(eventId)],
    ],
  });
}

/** Live forum events are always h-scoped; callers requery on deletes. */
export function subscribeToForum(
  channelId: string,
  onEvent: (event: NostrEvent) => void,
) {
  if (!channelId.trim()) return () => undefined;
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: FORUM_LIVE_KINDS,
      "#h": [channelId.trim()],
      since: Math.floor(Date.now() / 1_000),
    },
    onEvent,
  );
}

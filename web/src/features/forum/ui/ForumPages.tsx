import {
  ArrowLeft,
  Bookmark,
  ClipboardPaste,
  ChevronDown,
  MessageCircle,
  Paperclip,
  Pin,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  listProfiles,
  listWorkspaceChannels,
  type WorkspaceProfile,
} from "@/features/workspace/workspace-api";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import {
  buildCustomEmojiTags,
  emojiFromTags,
  type CustomEmoji,
} from "@/features/custom-emoji/custom-emoji-policy";
import { useCustomEmojiPalette } from "@/features/custom-emoji/custom-emoji-api";
import { CustomEmojiMarkdown } from "@/features/custom-emoji/ui/CustomEmojiMarkdown";
import { CustomEmojiPickerButton } from "@/features/custom-emoji/ui/CustomEmojiPickerButton";
import { readClipboardMediaFiles } from "@/features/media/browser-media";
import {
  buildOutgoingMediaMessage,
  parseImetaTags,
  stripAttachmentMarkdown,
} from "@/features/media/media-policy";
import { ComposerAttachments } from "@/features/media/ui/ComposerAttachments";
import { WorkspaceMediaGallery } from "@/features/media/ui/WorkspaceMediaGallery";
import { useComposerAttachments } from "@/features/media/useComposerAttachments";
import { Button } from "@/shared/ui/button";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  listUserEventReferences,
  readLocalChannelDrafts,
  setUserEventReference,
  subscribeToUserEventReferences,
  writeLocalChannelDrafts,
} from "@/features/channel-state/channel-state-api";
import { draftContextId } from "@/features/channel-state/channel-state-policy";
import {
  deleteForumEvent,
  getForumThread,
  listForumPosts,
  publishForumComment,
  publishForumPost,
  publishForumVote,
  subscribeToForum,
  type ForumCommentProjection,
  type ForumPostProjection,
} from "../forum-api";

function authorName(
  pubkey: string,
  profiles: Map<string, WorkspaceProfile> | undefined,
) {
  return profiles?.get(pubkey)?.name ?? truncatePubkey(pubkey);
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000 - timestamp));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return new Date(timestamp * 1_000).toLocaleDateString();
}

function ForumComposer({
  label,
  placeholder,
  submitting,
  draftChannelId,
  draftThreadId,
  customEmoji,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  submitting: boolean;
  draftChannelId?: string;
  draftThreadId?: string;
  customEmoji: readonly CustomEmoji[];
  onSubmit: (content: string, mediaTags?: string[][]) => Promise<unknown>;
}) {
  const { identity } = useWorkspaceIdentity();
  const [content, setContent] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const {
    addFiles,
    attachments,
    clear,
    hasFailed,
    hasUploading,
    readyAttachments,
    remove,
    retry,
  } = useComposerAttachments();
  const draftKey = draftChannelId
    ? draftContextId(draftChannelId, draftThreadId)
    : null;
  const [restoredDraftKey, setRestoredDraftKey] = React.useState<string | null>(
    null,
  );
  React.useEffect(() => {
    if (!identity || !draftKey) return;
    setContent(
      readLocalChannelDrafts(identity.pubkey).drafts[draftKey]?.content ?? "",
    );
    setRestoredDraftKey(draftKey);
  }, [draftKey, identity]);
  React.useEffect(() => {
    if (!identity || !draftKey || restoredDraftKey !== draftKey) return;
    const store = readLocalChannelDrafts(identity.pubkey);
    const drafts = { ...store.drafts };
    if (content) drafts[draftKey] = { content, updatedAt: Date.now() };
    else delete drafts[draftKey];
    writeLocalChannelDrafts(identity.pubkey, { version: 1, drafts });
  }, [content, draftKey, identity, restoredDraftKey]);
  const submit = async () => {
    if ((!content.trim() && readyAttachments.length === 0) || submitting)
      return;
    if (hasUploading) return;
    if (hasFailed) {
      setError("Resolve failed attachments before publishing.");
      return;
    }
    setError(null);
    try {
      const outgoing = buildOutgoingMediaMessage(content, readyAttachments);
      await onSubmit(outgoing.content, [
        ...(outgoing.mediaTags ?? []),
        ...buildCustomEmojiTags(outgoing.content, customEmoji),
      ]);
      setContent("");
      clear();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to publish forum content.",
      );
    }
  };
  const acceptFiles = (files: Iterable<File>) => {
    const errors = addFiles(files);
    if (errors.length) setError(errors.join(" "));
  };
  const insertCustomEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? content.length;
    const end = textarea?.selectionEnd ?? content.length;
    setContent(`${content.slice(0, start)}${emoji}${content.slice(end)}`);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 ${draggingFiles ? "ring-2 ring-primary/20" : ""}`}
    >
      <ComposerAttachments
        attachments={attachments}
        onRemove={remove}
        onRetry={retry}
      />
      <input
        className="sr-only"
        multiple
        ref={fileInputRef}
        type="file"
        onChange={(event) => {
          acceptFiles(event.target.files ?? []);
          event.target.value = "";
        }}
      />
      <textarea
        aria-label={label}
        className="min-h-24 w-full resize-y bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder={placeholder}
        ref={textareaRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            setDraggingFiles(true);
        }}
        onDragLeave={() => setDraggingFiles(false)}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingFiles(false);
          acceptFiles(event.dataTransfer.files);
        }}
        onPaste={(event) => {
          if (event.clipboardData.files.length === 0) return;
          event.preventDefault();
          acceptFiles(event.clipboardData.files);
        }}
      />
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            aria-label="Attach files"
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-3.5" />
          </Button>
          <Button
            aria-label="Paste image from clipboard"
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => {
              void readClipboardMediaFiles()
                .then(acceptFiles)
                .catch((reason) =>
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Clipboard files are unavailable.",
                  ),
                );
            }}
          >
            <ClipboardPaste className="size-3.5" />
          </Button>
          <CustomEmojiPickerButton
            emoji={customEmoji}
            label="Insert custom emoji"
            managePubkey={identity?.pubkey}
            onSelect={insertCustomEmoji}
          />
        </div>
        <Button
          disabled={
            (!content.trim() && readyAttachments.length === 0) ||
            submitting ||
            hasUploading ||
            hasFailed
          }
          size="sm"
          type="button"
          onClick={() => void submit()}
        >
          {submitting ? "Publishing…" : "Publish"}
        </Button>
      </div>
    </div>
  );
}

function VoteControls({
  event,
  channelId,
  disabled = false,
}: {
  event: Pick<
    ForumPostProjection | ForumCommentProjection,
    "id" | "score" | "voterCount"
  >;
  channelId: string;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const vote = useMutation({
    mutationFn: (direction: "+" | "-") =>
      publishForumVote(channelId, event.id, direction),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["forum-posts", channelId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["forum-thread", channelId],
      });
    },
  });
  return (
    <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
      <button
        aria-label="Upvote"
        className="rounded px-1.5 py-1 hover:bg-muted disabled:opacity-50"
        disabled={disabled || vote.isPending}
        type="button"
        onClick={() => vote.mutate("+")}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <strong className="min-w-5 text-center text-foreground">
        {event.score}
      </strong>
      <button
        aria-label="Downvote"
        className="rounded px-1.5 py-1 hover:bg-muted disabled:opacity-50"
        disabled={disabled || vote.isPending}
        type="button"
        onClick={() => vote.mutate("-")}
      >
        <ThumbsDown className="size-3.5" />
      </button>
      {event.voterCount ? (
        <span>
          {event.voterCount} voter{event.voterCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function DeleteButton({
  channelId,
  eventId,
}: {
  channelId: string;
  eventId: string;
}) {
  const queryClient = useQueryClient();
  const deletion = useMutation({
    mutationFn: () => deleteForumEvent(channelId, eventId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["forum-posts", channelId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["forum-thread", channelId],
      });
    },
  });
  return (
    <button
      aria-label="Delete forum content"
      className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
      disabled={deletion.isPending}
      type="button"
      onClick={() => {
        if (window.confirm("Delete this forum item?")) deletion.mutate();
      }}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

/** Profile-level NIP-51 actions: forum posts are not re-written or h-scoped. */
function UserEventListActions({
  eventId,
  ownPubkey,
}: {
  eventId: string;
  ownPubkey?: string;
}) {
  const [kind, setKind] = React.useState<10001 | 10003 | null>(null);
  const pinQuery = useQuery({
    queryKey: ["user-event-list", ownPubkey, 10001],
    queryFn: () => listUserEventReferences(ownPubkey ?? "", 10001),
    enabled: Boolean(ownPubkey),
  });
  const bookmarkQuery = useQuery({
    queryKey: ["user-event-list", ownPubkey, 10003],
    queryFn: () => listUserEventReferences(ownPubkey ?? "", 10003),
    enabled: Boolean(ownPubkey),
  });
  const mutation = useMutation({
    mutationFn: async ({
      targetKind,
      active,
    }: {
      targetKind: 10001 | 10003;
      active: boolean;
    }) => {
      if (!ownPubkey)
        throw new Error("Unlock an identity before updating saved items.");
      return setUserEventReference(ownPubkey, targetKind, eventId, active);
    },
    onSuccess: () => {
      if (kind)
        void (kind === 10001 ? pinQuery.refetch() : bookmarkQuery.refetch());
      setKind(null);
    },
  });
  React.useEffect(() => {
    if (!ownPubkey) return;
    return subscribeToUserEventReferences(
      ownPubkey,
      10001,
      () => void pinQuery.refetch(),
    );
  }, [ownPubkey, pinQuery.refetch]);
  React.useEffect(() => {
    if (!ownPubkey) return;
    return subscribeToUserEventReferences(
      ownPubkey,
      10003,
      () => void bookmarkQuery.refetch(),
    );
  }, [bookmarkQuery.refetch, ownPubkey]);
  if (!ownPubkey) return null;
  const pinned = pinQuery.data?.includes(eventId) ?? false;
  const bookmarked = bookmarkQuery.data?.includes(eventId) ?? false;
  return (
    <div className="ml-auto flex items-center gap-1">
      <button
        aria-label={pinned ? "Unpin post" : "Pin post"}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        disabled={mutation.isPending}
        type="button"
        onClick={() => {
          setKind(10001);
          mutation.mutate({ targetKind: 10001, active: !pinned });
        }}
      >
        <Pin className={pinned ? "size-3.5 fill-current" : "size-3.5"} />
      </button>
      <button
        aria-label={bookmarked ? "Remove bookmark" : "Bookmark post"}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        disabled={mutation.isPending}
        type="button"
        onClick={() => {
          setKind(10003);
          mutation.mutate({ targetKind: 10003, active: !bookmarked });
        }}
      >
        <Bookmark
          className={bookmarked ? "size-3.5 fill-current" : "size-3.5"}
        />
      </button>
    </div>
  );
}

function ForumPostCard({
  channelId,
  post,
  profiles,
  ownPubkey,
}: {
  channelId: string;
  post: ForumPostProjection;
  profiles: Map<string, WorkspaceProfile> | undefined;
  ownPubkey?: string;
}) {
  const body = stripAttachmentMarkdown(post.content, parseImetaTags(post.tags));
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">
          {authorName(post.pubkey, profiles)}
        </span>
        <span>{relativeTime(post.created_at)}</span>
        {ownPubkey?.toLowerCase() === post.pubkey.toLowerCase() ? (
          <span className="ml-auto">
            <DeleteButton channelId={channelId} eventId={post.id} />
          </span>
        ) : null}
      </div>
      <Link
        className="prose prose-sm mt-3 block max-w-none break-words hover:opacity-80 dark:prose-invert"
        to="/channels/$channelId/posts/$postId"
        params={{ channelId, postId: post.id }}
      >
        <CustomEmojiMarkdown content={body} emoji={emojiFromTags(post.tags)} />
      </Link>
      <WorkspaceMediaGallery tags={post.tags} />
      <div className="flex flex-wrap items-center gap-3">
        <VoteControls channelId={channelId} event={post} />
        <Link
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          to="/channels/$channelId/posts/$postId"
          params={{ channelId, postId: post.id }}
        >
          <MessageCircle className="size-3.5" /> {post.commentCount}{" "}
          {post.commentCount === 1 ? "comment" : "comments"}
        </Link>
        <UserEventListActions eventId={post.id} ownPubkey={ownPubkey} />
      </div>
    </article>
  );
}

function useForumLiveRefresh(channelId: string) {
  const queryClient = useQueryClient();
  React.useEffect(
    () =>
      subscribeToForum(channelId, () => {
        void queryClient.invalidateQueries({
          queryKey: ["forum-posts", channelId],
        });
        void queryClient.invalidateQueries({
          queryKey: ["forum-thread", channelId],
        });
      }),
    [channelId, queryClient],
  );
}

function useForumChannel(channelId: string) {
  const { identity } = useWorkspaceIdentity();
  const channelsQuery = useQuery({
    queryKey: ["workspace-channels", identity?.pubkey],
    queryFn: () => listWorkspaceChannels(identity?.pubkey ?? ""),
    enabled: Boolean(identity),
    retry: false,
  });
  return {
    channel:
      channelsQuery.data?.find((channel) => channel.id === channelId) ?? null,
    channelsQuery,
    identity,
  };
}

export function ForumChannelPage({ channelId }: { channelId: string }) {
  const { channel, channelsQuery, identity } = useForumChannel(channelId);
  useForumLiveRefresh(channelId);
  const [before, setBefore] = React.useState<number | undefined>();
  const [pageNumber, setPageNumber] = React.useState(1);
  const postsQuery = useQuery({
    queryKey: ["forum-posts", channelId, before ?? null],
    queryFn: () => listForumPosts(channelId, before),
    enabled: Boolean(channel && channel.type === "forum"),
    retry: false,
  });
  const postMutation = useMutation({
    mutationFn: ({
      content,
      mediaTags,
    }: {
      content: string;
      mediaTags?: string[][];
    }) => publishForumPost(channelId, content, [], mediaTags),
  });
  const customEmojiQuery = useCustomEmojiPalette(channel?.memberPubkeys ?? []);
  const posts = postsQuery.data?.posts ?? [];
  const pubkeys = React.useMemo(
    () => [...new Set(posts.map((post) => post.pubkey))].sort(),
    [posts],
  );
  const profilesQuery = useQuery({
    queryKey: ["forum-profiles", pubkeys.join(",")],
    queryFn: () => listProfiles(pubkeys),
    enabled: pubkeys.length > 0,
  });

  if (channelsQuery.isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading forum…</p>;
  if (channel?.type !== "forum") {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        This forum is unavailable or you do not have access.
      </p>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-7">
      <header className="mb-5">
        <Link
          className="text-xs text-muted-foreground hover:underline"
          to="/"
          search={{ channel: channelId }}
        >
          ← Back to workspace
        </Link>
        <Link
          className="ml-3 text-xs text-muted-foreground hover:underline"
          to="/channel-state"
          search={{ channel: channelId, thread: undefined }}
        >
          Channel state
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">#{channel.name}</h1>
        {channel.about ? (
          <p className="mt-1 text-sm text-muted-foreground">{channel.about}</p>
        ) : null}
      </header>
      <ForumComposer
        label={`New forum post in ${channel.name}`}
        placeholder="Start a discussion with Markdown…"
        draftChannelId={channelId}
        customEmoji={customEmojiQuery.data ?? []}
        submitting={postMutation.isPending}
        onSubmit={async (content, mediaTags) => {
          await postMutation.mutateAsync({ content, mediaTags });
          await postsQuery.refetch();
        }}
      />
      {postsQuery.isError ? (
        <p className="mt-4 text-sm text-destructive">
          {postsQuery.error.message}
        </p>
      ) : null}
      <div className="mt-5 space-y-3">
        {posts.map((post) => (
          <ForumPostCard
            channelId={channelId}
            key={post.id}
            ownPubkey={identity?.pubkey}
            post={post}
            profiles={profilesQuery.data}
          />
        ))}
        {!postsQuery.isLoading && !posts.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No discussions yet. Start the first one.
          </p>
        ) : null}
      </div>
      {postsQuery.data?.nextBefore ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">Page {pageNumber}</p>
          <Button
            variant="outline"
            onClick={() => {
              setBefore(postsQuery.data?.nextBefore ?? undefined);
              setPageNumber((page) => page + 1);
            }}
          >
            <ChevronDown /> Next page
          </Button>
        </div>
      ) : null}
    </main>
  );
}

export function ForumPostPage({
  channelId,
  postId,
}: {
  channelId: string;
  postId: string;
}) {
  const { channel, channelsQuery, identity } = useForumChannel(channelId);
  useForumLiveRefresh(channelId);
  const threadQuery = useQuery({
    queryKey: ["forum-thread", channelId, postId],
    queryFn: () => getForumThread(channelId, postId),
    enabled: Boolean(channel && channel.type === "forum"),
    retry: false,
  });
  const commentMutation = useMutation({
    mutationFn: ({
      content,
      mediaTags,
    }: {
      content: string;
      mediaTags?: string[][];
    }) =>
      publishForumComment({
        channelId,
        content,
        rootEventId: postId,
        mediaTags,
      }),
  });
  const customEmojiQuery = useCustomEmojiPalette(channel?.memberPubkeys ?? []);
  const pubkeys = React.useMemo(
    () =>
      [
        ...new Set(
          [
            threadQuery.data?.post?.pubkey,
            ...(threadQuery.data?.comments.map((comment) => comment.pubkey) ??
              []),
          ].filter((pubkey): pubkey is string => Boolean(pubkey)),
        ),
      ].sort(),
    [threadQuery.data],
  );
  const profilesQuery = useQuery({
    queryKey: ["forum-profiles", pubkeys.join(",")],
    queryFn: () => listProfiles(pubkeys),
    enabled: pubkeys.length > 0,
  });
  if (channelsQuery.isLoading || threadQuery.isLoading)
    return (
      <p className="p-6 text-sm text-muted-foreground">Loading discussion…</p>
    );
  if (channel?.type !== "forum" || !threadQuery.data?.post)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        This forum post is unavailable or you do not have access.
      </p>
    );
  const { post, comments } = threadQuery.data;
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-7">
      <Link
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        to="/channels/$channelId/posts"
        params={{ channelId }}
      >
        <ArrowLeft className="size-3.5" /> Back to #{channel.name}
      </Link>
      <article className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {authorName(post.pubkey, profilesQuery.data)}
          </span>
          <span>{relativeTime(post.created_at)}</span>
          {identity?.pubkey.toLowerCase() === post.pubkey.toLowerCase() ? (
            <span className="ml-auto">
              <DeleteButton channelId={channelId} eventId={post.id} />
            </span>
          ) : null}
        </div>
        <div className="prose prose-sm mt-4 max-w-none break-words dark:prose-invert">
          <CustomEmojiMarkdown
            content={stripAttachmentMarkdown(
              post.content,
              parseImetaTags(post.tags),
            )}
            emoji={emojiFromTags(post.tags)}
          />
        </div>
        <WorkspaceMediaGallery tags={post.tags} />
        <VoteControls channelId={channelId} event={post} />
        <UserEventListActions eventId={post.id} ownPubkey={identity?.pubkey} />
      </article>
      <h2 className="mt-6 text-sm font-semibold">
        {comments.length} {comments.length === 1 ? "comment" : "comments"}
      </h2>
      <div className="mt-3 space-y-3">
        {comments.map((comment) => (
          <article
            className="rounded-xl border border-border p-4"
            key={comment.id}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {authorName(comment.pubkey, profilesQuery.data)}
              </span>
              <span>{relativeTime(comment.created_at)}</span>
              {identity?.pubkey.toLowerCase() ===
              comment.pubkey.toLowerCase() ? (
                <span className="ml-auto">
                  <DeleteButton channelId={channelId} eventId={comment.id} />
                </span>
              ) : null}
            </div>
            <div className="prose prose-sm mt-3 max-w-none break-words dark:prose-invert">
              <CustomEmojiMarkdown
                content={stripAttachmentMarkdown(
                  comment.content,
                  parseImetaTags(comment.tags),
                )}
                emoji={emojiFromTags(comment.tags)}
              />
            </div>
            <WorkspaceMediaGallery tags={comment.tags} />
            <VoteControls channelId={channelId} event={comment} />
          </article>
        ))}
      </div>
      <div className="mt-5">
        <ForumComposer
          label="Add forum comment"
          placeholder="Add a comment with Markdown…"
          draftChannelId={channelId}
          draftThreadId={postId}
          customEmoji={customEmojiQuery.data ?? []}
          submitting={commentMutation.isPending}
          onSubmit={async (content, mediaTags) => {
            await commentMutation.mutateAsync({ content, mediaTags });
            await threadQuery.refetch();
          }}
        />
      </div>
    </main>
  );
}

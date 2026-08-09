import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import type { WorkspaceMessage } from "./workspace-api";
import type { CustomEmoji } from "@/features/custom-emoji/custom-emoji-policy";
import {
  listReactions,
  reactToWorkspaceMessage,
  removeWorkspaceReaction,
  subscribeToReactions,
} from "./workspace-api";
import {
  applyOptimisticReactionToggle,
  type WorkspaceReactionMap,
} from "./reaction-cache";

type QueuedReaction = {
  id: number;
  promise: Promise<unknown>;
};

/**
 * Keeps reaction state local to the workspace timeline. Updates are optimistic
 * and each message/emoji pair is serialized, so an immediate second click
 * removes the exact kind-7 event produced by the first one.
 */
export function useWorkspaceReactions(
  messages: WorkspaceMessage[],
  ownPubkey: string,
  customEmoji: readonly CustomEmoji[] = [],
) {
  const queryClient = useQueryClient();
  const messageIds = React.useMemo(
    () => messages.map((message) => message.id),
    [messages],
  );
  const reactionsQuery = useQuery({
    queryKey: ["workspace-reactions", messageIds],
    queryFn: () => listReactions(messageIds),
    enabled: messageIds.length > 0,
  });
  const reactionQueuesRef = React.useRef(new Map<string, QueuedReaction>());
  const reactionOperationIdRef = React.useRef(0);

  React.useEffect(
    () =>
      subscribeToReactions(messageIds, () => {
        // Re-query only after the local queue settles. A relay echo midway
        // through a rapid add/remove would otherwise undo the optimistic UI.
        if (reactionQueuesRef.current.size > 0) return;
        void queryClient.invalidateQueries({
          queryKey: ["workspace-reactions"],
        });
      }),
    [messageIds, queryClient],
  );

  const queueReactionOperation = React.useCallback(
    ({
      message,
      emoji,
      emojiMetadata,
      remove,
      knownReactionEventId,
    }: {
      message: WorkspaceMessage;
      emoji: string;
      emojiMetadata?: CustomEmoji;
      remove: boolean;
      knownReactionEventId?: string;
    }) => {
      const key = `${message.id}:${emoji}`;
      const previous = reactionQueuesRef.current.get(key)?.promise;
      const id = ++reactionOperationIdRef.current;
      const operation = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() =>
          remove
            ? removeWorkspaceReaction(
                message,
                emoji,
                ownPubkey,
                knownReactionEventId,
              )
            : reactToWorkspaceMessage(message, emoji, emojiMetadata),
        );
      reactionQueuesRef.current.set(key, { id, promise: operation });
      void operation
        .finally(() => {
          if (reactionQueuesRef.current.get(key)?.id !== id) return;
          reactionQueuesRef.current.delete(key);
          void queryClient.invalidateQueries({
            queryKey: ["workspace-reactions"],
          });
        })
        .catch(() => undefined);
      return operation;
    },
    [ownPubkey, queryClient],
  );

  const reactMutation = useMutation({
    mutationFn: ({
      message,
      emoji,
      emojiMetadata,
      remove,
      knownReactionEventId,
    }: {
      message: WorkspaceMessage;
      emoji: string;
      emojiMetadata?: CustomEmoji;
      remove: boolean;
      knownReactionEventId?: string;
    }) =>
      queueReactionOperation({
        message,
        emoji,
        emojiMetadata,
        remove,
        knownReactionEventId,
      }),
    onMutate: async ({ message, emoji, emojiMetadata, remove }) => {
      await queryClient.cancelQueries({ queryKey: ["workspace-reactions"] });
      const previous = queryClient.getQueriesData<WorkspaceReactionMap>({
        queryKey: ["workspace-reactions"],
      });
      queryClient.setQueriesData<WorkspaceReactionMap>(
        { queryKey: ["workspace-reactions"] },
        (current) =>
          current
            ? applyOptimisticReactionToggle(current, {
                messageId: message.id,
                emoji,
                emojiUrl: emojiMetadata?.url,
                ownPubkey,
                remove,
              })
            : current,
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      for (const [queryKey, reactions] of context?.previous ?? []) {
        queryClient.setQueryData(queryKey, reactions);
      }
      toast.error("Reaction could not be updated", {
        description:
          error instanceof Error
            ? error.message
            : "Please try that reaction again.",
      });
    },
  });
  const mutateReaction = reactMutation.mutate;
  const toggleReaction = React.useCallback(
    (message: WorkspaceMessage, emoji: string) => {
      const reaction = reactionsQuery.data
        ?.get(message.id)
        ?.find((summary) => summary.emoji === emoji);
      const remove = Boolean(reaction?.authors.includes(ownPubkey));
      const emojiMetadata = customEmoji.find(
        (candidate) =>
          emoji.trim().toLowerCase() === `:${candidate.shortcode}:`,
      );
      mutateReaction({
        message,
        emoji,
        emojiMetadata,
        remove,
        knownReactionEventId: reaction?.reactionEventIdsByAuthor[ownPubkey],
      });
    },
    [customEmoji, mutateReaction, ownPubkey, reactionsQuery.data],
  );
  const reactionActorPubkeys = React.useMemo(
    () => [
      ...new Set(
        [...(reactionsQuery.data?.values() ?? [])].flatMap((summaries) =>
          summaries.flatMap((reaction) => reaction.authors),
        ),
      ),
    ],
    [reactionsQuery.data],
  );

  return {
    reactionActorPubkeys,
    reactions: reactionsQuery.data,
    toggleReaction,
  };
}

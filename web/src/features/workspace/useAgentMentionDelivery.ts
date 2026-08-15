import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import type { BrowserIdentity } from "@/shared/lib/browser-identity";
import {
  type WorkspaceChannel,
  type WorkspaceMessage,
  type WorkspaceProfile,
  addWorkspaceMember,
  sendWorkspaceMessage,
} from "./workspace-api";

type SendVariables = {
  content: string;
  mentions: string[];
  mediaTags?: string[][];
  replyTo?: WorkspaceMessage;
};

type SendResult = {
  addedAgents: WorkspaceProfile[];
  channelId: string;
  channelName: string;
  event: Awaited<ReturnType<typeof sendWorkspaceMessage>>;
};

function personalAgentError(agents: WorkspaceProfile[]): Error {
  const names = agents.map((agent) => agent.name).join(", ");
  const description =
    agents.length === 1 ? "is a personal assistant" : "are personal assistants";
  return new Error(
    `${names} ${description} and cannot be added to a shared channel. Use the private brief channel instead.`,
  );
}

export function useAgentMentionDelivery({
  activeChannel,
  activeChannelId,
  agents,
  identity,
}: {
  activeChannel: WorkspaceChannel | null;
  activeChannelId: string | null;
  agents: WorkspaceProfile[];
  identity: BrowserIdentity | null;
}) {
  const queryClient = useQueryClient();
  const addAgentToChannelCache = React.useCallback(
    (channelId: string, agentPubkey: string) => {
      queryClient.setQueryData<WorkspaceChannel[]>(
        ["workspace-channels", identity?.pubkey],
        (current = []) =>
          current.map((channel) =>
            channel.id === channelId &&
            !channel.memberPubkeys.includes(agentPubkey)
              ? {
                  ...channel,
                  memberPubkeys: [...channel.memberPubkeys, agentPubkey],
                }
              : channel,
          ),
      );
    },
    [identity?.pubkey, queryClient],
  );

  const sendMutation = useMutation({
    mutationFn: async ({
      content,
      mentions,
      mediaTags,
      replyTo,
    }: SendVariables): Promise<SendResult> => {
      const channelId = activeChannelId ?? "";
      const mentionedAgents = agents.filter((agent) =>
        mentions.includes(agent.pubkey),
      );
      const missingAgents = mentionedAgents.filter(
        (agent) => !activeChannel?.memberPubkeys.includes(agent.pubkey),
      );
      const missingPersonalAgents = missingAgents.filter(
        (agent) => agent.accessTier === "personal",
      );
      if (missingPersonalAgents.length) {
        throw personalAgentError(missingPersonalAgents);
      }
      for (const agent of missingAgents) {
        await addWorkspaceMember(channelId, agent.pubkey, "bot");
        addAgentToChannelCache(channelId, agent.pubkey);
      }
      return {
        addedAgents: missingAgents,
        channelId,
        channelName: activeChannel?.name ?? "this channel",
        event: await sendWorkspaceMessage(
          channelId,
          content,
          replyTo,
          mentions,
          mediaTags,
        ),
      };
    },
    onMutate: (variables) => {
      // Echo the message into the timeline immediately; the relay round trip
      // replaces it with the accepted event or rolls it back on failure.
      const channelId = activeChannelId ?? "";
      if (!identity || !channelId) return { channelId, pendingId: null };
      const pendingId = `pending-${crypto.randomUUID().replace(/-/g, "")}`;
      const pending: WorkspaceMessage = {
        id: pendingId,
        pubkey: identity.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9,
        tags: [["h", channelId]],
        content: variables.content,
        sig: "",
        channelId,
        parentEventId: variables.replyTo?.id ?? null,
        rootEventId: variables.replyTo
          ? (variables.replyTo.rootEventId ?? variables.replyTo.id)
          : null,
      };
      queryClient.setQueryData<WorkspaceMessage[]>(
        ["channel-messages", channelId],
        (current = []) => [...current, pending],
      );
      return { channelId, pendingId };
    },
    onError: (error, _variables, context) => {
      if (context?.pendingId) {
        queryClient.setQueryData<WorkspaceMessage[]>(
          ["channel-messages", context.channelId],
          (current = []) =>
            current.filter((message) => message.id !== context.pendingId),
        );
      }
      toast.error("Message was not sent", {
        description:
          error instanceof Error
            ? error.message
            : "The hosted agent could not be added to this channel.",
      });
    },
    onSuccess: (
      { addedAgents, channelId, channelName, event },
      variables,
      context,
    ) => {
      queryClient.setQueryData<WorkspaceMessage[]>(
        ["channel-messages", channelId],
        (current = []) => [
          ...current.filter(
            (message) =>
              message.id !== context?.pendingId && message.id !== event.id,
          ),
          {
            ...event,
            channelId,
            parentEventId: variables.replyTo?.id ?? null,
            rootEventId: variables.replyTo
              ? (variables.replyTo.rootEventId ?? variables.replyTo.id)
              : null,
          },
        ],
      );
      if (addedAgents.length) {
        toast.success(
          `${addedAgents.map((agent) => agent.name).join(", ")} ${
            addedAgents.length === 1 ? "was" : "were"
          } added to #${channelName}`,
        );
      }
    },
  });

  const addAgentMutation = useMutation({
    mutationFn: (agent: WorkspaceProfile) =>
      addWorkspaceMember(activeChannelId ?? "", agent.pubkey, "bot"),
    onError: (error) => {
      toast.error("Could not add the hosted agent", {
        description:
          error instanceof Error
            ? error.message
            : "Owner or admin access is required.",
      });
    },
    onSuccess: (_, agent) => {
      if (activeChannelId)
        addAgentToChannelCache(activeChannelId, agent.pubkey);
      toast.success(`${agent.name} was added to this channel`);
      // The relay emits a kind:39002 replacement head; invalidate now so the
      // local optimistic cache converges even if a second client wins the head.
      void queryClient.invalidateQueries({
        queryKey: ["workspace-channels", identity?.pubkey],
      });
    },
  });

  return { addAgentMutation, sendMutation };
}

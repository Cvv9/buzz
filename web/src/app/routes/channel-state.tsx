import { createFileRoute } from "@tanstack/react-router";
import { ChannelStatePage } from "@/features/channel-state/ui/ChannelStatePage";

export const Route = createFileRoute("/channel-state")({
  component: ChannelStatePage,
  validateSearch: (search: Record<string, unknown>) => ({
    channel: typeof search.channel === "string" ? search.channel : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
  }),
});

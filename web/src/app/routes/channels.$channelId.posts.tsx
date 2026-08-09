import { createFileRoute } from "@tanstack/react-router";
import { ForumChannelPage } from "@/features/forum/ui/ForumPages";

export const Route = createFileRoute("/channels/$channelId/posts")({
  component: ForumChannelRoute,
});

function ForumChannelRoute() {
  const { channelId } = Route.useParams();
  return <ForumChannelPage channelId={channelId} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { ForumPostPage } from "@/features/forum/ui/ForumPages";

export const Route = createFileRoute("/channels/$channelId/posts/$postId")({
  component: ForumPostRoute,
});

function ForumPostRoute() {
  const { channelId, postId } = Route.useParams();
  return <ForumPostPage channelId={channelId} postId={postId} />;
}

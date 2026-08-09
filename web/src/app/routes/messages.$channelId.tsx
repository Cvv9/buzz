import { createFileRoute } from "@tanstack/react-router";
import { WorkspacePage } from "@/features/workspace/ui/WorkspacePage";

export const Route = createFileRoute("/messages/$channelId")({
  component: MessageRoute,
});

function MessageRoute() {
  const { channelId } = Route.useParams();
  return <WorkspacePage channelPermalink={channelId} />;
}

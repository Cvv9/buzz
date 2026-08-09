import { createFileRoute } from "@tanstack/react-router";
import { HuddlePage } from "@/features/huddle/ui/HuddlePage";

export const Route = createFileRoute("/huddles/$channelId")({
  component: HuddleRoute,
});

function HuddleRoute() {
  const { channelId } = Route.useParams();
  return <HuddlePage channelId={channelId} />;
}

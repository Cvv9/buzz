import { createFileRoute } from "@tanstack/react-router";
import { WorkspacePage } from "@/features/workspace/ui/WorkspacePage";

export const Route = createFileRoute("/messages/new")({
  component: () => <WorkspacePage routeMode="new-message" />,
});

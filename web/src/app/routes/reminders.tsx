import { createFileRoute } from "@tanstack/react-router";
import { WorkspacePage } from "@/features/workspace/ui/WorkspacePage";

export const Route = createFileRoute("/reminders")({
  component: () => <WorkspacePage routeMode="reminders" />,
});

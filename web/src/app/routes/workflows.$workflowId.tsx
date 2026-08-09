import { createFileRoute } from "@tanstack/react-router";
import { WorkflowDetailPage } from "@/features/workflows/ui/WorkflowDetailPage";

export const Route = createFileRoute("/workflows/$workflowId")({
  component: WorkflowDetailRoute,
});

function WorkflowDetailRoute() {
  const { workflowId } = Route.useParams();
  return <WorkflowDetailPage workflowId={workflowId} />;
}

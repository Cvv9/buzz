import { createFileRoute } from "@tanstack/react-router";
import { RepositoryWorkItemsPage } from "@/features/projects/ui/ProjectsPage";

export const Route = createFileRoute(
  "/repos/$repositoryAddress/work-items/$workItemId",
)({
  component: WorkItemRoute,
});

function WorkItemRoute() {
  const { repositoryAddress, workItemId } = Route.useParams();
  return (
    <RepositoryWorkItemsPage
      repositoryAddress={repositoryAddress}
      workItemId={workItemId}
    />
  );
}

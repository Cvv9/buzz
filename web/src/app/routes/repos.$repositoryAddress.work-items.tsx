import { createFileRoute } from "@tanstack/react-router";
import { RepositoryWorkItemsPage } from "@/features/projects/ui/ProjectsPage";

export const Route = createFileRoute("/repos/$repositoryAddress/work-items")({
  component: WorkItemsRoute,
});

function WorkItemsRoute() {
  const { repositoryAddress } = Route.useParams();
  return <RepositoryWorkItemsPage repositoryAddress={repositoryAddress} />;
}

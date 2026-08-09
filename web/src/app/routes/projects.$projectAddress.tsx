import { createFileRoute } from "@tanstack/react-router";
import { ProjectDetailPage } from "@/features/projects/ui/ProjectsPage";

export const Route = createFileRoute("/projects/$projectAddress")({
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectAddress } = Route.useParams();
  return <ProjectDetailPage projectAddress={projectAddress} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "@/features/projects/ui/ProjectsPage";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});

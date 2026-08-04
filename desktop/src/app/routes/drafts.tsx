import { createFileRoute } from "@tanstack/react-router";

import { HomeRouteComponent } from "@/app/routes/index";

export const Route = createFileRoute("/drafts")({
  component: DraftsRouteComponent,
});

function DraftsRouteComponent() {
  return <HomeRouteComponent initialFilter="drafts" />;
}

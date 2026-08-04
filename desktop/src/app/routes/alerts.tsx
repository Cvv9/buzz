import { createFileRoute } from "@tanstack/react-router";

import { HomeRouteComponent } from "@/app/routes/index";

export const Route = createFileRoute("/alerts")({
  component: AlertsRouteComponent,
});

function AlertsRouteComponent() {
  return <HomeRouteComponent initialFilter="alerts" />;
}

import { createFileRoute } from "@tanstack/react-router";

import { HomeRouteComponent } from "@/app/routes/index";

export const Route = createFileRoute("/reminders")({
  component: RemindersRouteComponent,
});

function RemindersRouteComponent() {
  return <HomeRouteComponent initialFilter="reminders" />;
}

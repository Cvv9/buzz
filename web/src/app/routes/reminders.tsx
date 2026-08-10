import { createFileRoute } from "@tanstack/react-router";
import { RemindersPage } from "@/features/reminders/ui/RemindersPage";

export const Route = createFileRoute("/reminders")({
  component: RemindersPage,
});

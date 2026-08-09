import { createFileRoute } from "@tanstack/react-router";
import { ModerationPage } from "@/features/moderation/ui/ModerationPage";

export const Route = createFileRoute("/moderation")({
  component: ModerationPage,
});

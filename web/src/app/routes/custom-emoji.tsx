import { createFileRoute } from "@tanstack/react-router";
import { CustomEmojiSettingsPage } from "@/features/custom-emoji/ui/CustomEmojiSettingsPage";

export const Route = createFileRoute("/custom-emoji")({
  component: CustomEmojiSettingsPage,
});

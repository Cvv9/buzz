import { createFileRoute } from "@tanstack/react-router";
import { OfflineArchivePage } from "@/features/offline/ui/OfflineArchivePage";

export const Route = createFileRoute("/offline")({
  component: OfflineArchivePage,
});

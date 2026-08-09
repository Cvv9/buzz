import { createFileRoute } from "@tanstack/react-router";
import { IdentityArchivePage } from "@/features/identity-archive/ui/IdentityArchivePage";

export const Route = createFileRoute("/identity-archive")({
  component: IdentityArchivePage,
});

import { createFileRoute } from "@tanstack/react-router";
import { PairingPage } from "@/features/pairing/ui/PairingPage";

export const Route = createFileRoute("/pairing")({
  component: PairingPage,
});

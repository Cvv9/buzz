import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/features/profiles/ui/ProfilePage";

export const Route = createFileRoute("/profiles/$pubkey")({
  component: ProfileRoute,
});

function ProfileRoute() {
  const { pubkey } = Route.useParams();
  return <ProfilePage pubkey={pubkey} />;
}

import { useNavigate } from "@tanstack/react-router";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import { WorkspaceSettings } from "@/features/workspace/ui/WorkspaceSettings";
import { lockBrowserIdentity } from "@/shared/lib/browser-identity";

export function SettingsPage() {
  const navigate = useNavigate();
  return (
    <WorkspaceIdentityGate>
      {(identity) => (
        <WorkspaceSettings
          identity={identity}
          onClose={() => {
            void navigate({ to: "/" });
          }}
          onSignOut={() => {
            lockBrowserIdentity();
            window.location.href = "/";
          }}
        />
      )}
    </WorkspaceIdentityGate>
  );
}

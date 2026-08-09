import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import { WorkspaceSettings } from "@/features/workspace/ui/WorkspaceSettings";
import { lockBrowserIdentity } from "@/shared/lib/browser-identity";

export function SettingsPage() {
  return (
    <WorkspaceIdentityGate>
      {(identity) => (
        <WorkspaceSettings
          identity={identity}
          onClose={() => {
            window.location.href = "/";
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

import { useNavigate } from "@tanstack/react-router";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import { RemindersPanel } from "./RemindersPanel";

/**
 * A direct Reminders route only needs the unlocked browser identity. Keeping
 * it independent from channel membership avoids leaving the page behind a
 * workspace-catalog connection on a cold load.
 */
export function RemindersPage() {
  const navigate = useNavigate();
  return (
    <WorkspaceIdentityGate>
      {(identity) => (
        <main className="flex min-h-dvh bg-background text-foreground">
          <RemindersPanel
            pubkey={identity.pubkey}
            onBack={() => void navigate({ to: "/" })}
            onOpenTarget={(reminder) => {
              const channelId = reminder.content.target?.channelId;
              if (!channelId) return;
              void navigate({
                to: "/messages/$channelId",
                params: { channelId },
              });
            }}
          />
        </main>
      )}
    </WorkspaceIdentityGate>
  );
}

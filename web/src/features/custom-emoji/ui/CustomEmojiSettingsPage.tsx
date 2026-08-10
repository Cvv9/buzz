import { SmilePlus } from "lucide-react";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import { BrowserSettingsBreadcrumb } from "@/features/settings/ui/BrowserSettingsBreadcrumb";
import { EmojiSetManager } from "./CustomEmojiPickerButton";

export function CustomEmojiSettingsPage() {
  return (
    <WorkspaceIdentityGate>
      {(identity) => (
        <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-8">
          <div className="mx-auto max-w-3xl">
            <BrowserSettingsBreadcrumb current="Custom emoji" />
            <header className="flex items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <SmilePlus className="size-5" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Custom emoji
                </h1>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Manage the NIP-30 emoji set attached to this Buzz identity.
                  Changes are signed and available in messages and reactions.
                </p>
              </div>
            </header>
            <section className="mt-7 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
              <EmojiSetManager pubkey={identity.pubkey} />
            </section>
          </div>
        </main>
      )}
    </WorkspaceIdentityGate>
  );
}

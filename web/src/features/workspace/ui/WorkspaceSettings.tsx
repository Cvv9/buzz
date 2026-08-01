import { Bell, LogOut, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { mintBrowserInvite } from "@/features/invite/invite-api";
import {
  type BrowserIdentity,
  exportBrowserIdentity,
} from "@/shared/lib/browser-identity";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";

export function WorkspaceSettings({
  identity,
  onClose,
  onSignOut,
}: {
  identity: BrowserIdentity;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const [backup, setBackup] = React.useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
  const [mintingInvite, setMintingInvite] = React.useState(false);
  const [openingDesktop, setOpeningDesktop] = React.useState(false);
  const [notificationPermission, setNotificationPermission] = React.useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
      <button
        aria-label="Close settings"
        className="absolute inset-0"
        type="button"
        onClick={onClose}
      />
      <section className="relative h-full w-full max-w-md overflow-y-auto bg-[#f7f8f2] p-6 shadow-2xl dark:bg-[#1b1e19]">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-black/40 dark:text-white/35">
              VarVik Studios
            </p>
            <h2 className="mt-1 text-xl font-semibold">Browser identity</h2>
          </div>
          <button
            aria-label="Close settings"
            className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
            type="button"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="mt-8 rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <p className="font-medium">{identity.displayName}</p>
          <p className="mt-1 break-all font-mono text-xs text-black/45 dark:text-white/40">
            {identity.pubkey}
          </p>
        </div>
        <div className="mt-7">
          <h3 className="text-sm font-semibold">Recovery key</h3>
          <p className="mt-2 text-sm leading-6 text-black/50 dark:text-white/45">
            Save this private key in a password manager. Anyone who has it can
            act as you.
          </p>
          {backup ? (
            <div className="mt-3 break-all rounded-xl bg-black/[0.045] p-3 font-mono text-xs dark:bg-white/[0.05]">
              {backup}
            </div>
          ) : null}
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void exportBrowserIdentity().then(setBackup)}
          >
            {backup ? "Recovery key revealed" : "Reveal recovery key"}
          </Button>
        </div>
        <div className="mt-7 border-t border-black/8 pt-6 dark:border-white/8">
          <h3 className="text-sm font-semibold">Browser notifications</h3>
          <p className="mt-2 text-sm leading-6 text-black/50 dark:text-white/45">
            Show notifications for new messages in other channels while Buzz is
            open in this browser.
          </p>
          <Button
            className="mt-3"
            disabled={
              notificationPermission === "unsupported" ||
              notificationPermission === "granted"
            }
            variant="outline"
            onClick={() => {
              void Notification.requestPermission().then((permission) => {
                setNotificationPermission(permission);
                if (permission === "granted") {
                  toast.success("Browser notifications enabled");
                } else if (permission === "denied") {
                  toast.error("Notifications are blocked", {
                    description:
                      "Allow notifications for Buzz in your browser settings.",
                  });
                }
              });
            }}
          >
            <Bell className="mr-2 size-4" />
            {notificationPermission === "granted"
              ? "Notifications enabled"
              : notificationPermission === "denied"
                ? "Notifications blocked"
                : notificationPermission === "unsupported"
                  ? "Not supported by this browser"
                  : "Enable notifications"}
          </Button>
        </div>
        <div className="mt-7 border-t border-black/8 pt-6 dark:border-white/8">
          <h3 className="text-sm font-semibold">Buzz Desktop</h3>
          <p className="mt-2 text-sm leading-6 text-black/50 dark:text-white/45">
            Open this same community in the desktop app. A one-use invitation
            safely adds the identity stored by Buzz Desktop.
          </p>
          <Button
            className="mt-3"
            disabled={openingDesktop}
            variant="outline"
            onClick={() => {
              setOpeningDesktop(true);
              void mintBrowserInvite()
                .then((invite) => {
                  const query = new URLSearchParams({
                    relay: relayWsUrl(),
                    code: invite.code,
                  });
                  window.location.href = `buzz://join?${query.toString()}`;
                })
                .catch((error) => {
                  toast.error("Could not open Buzz Desktop", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "Owner or admin access is required.",
                  });
                })
                .finally(() => setOpeningDesktop(false));
            }}
          >
            {openingDesktop ? "Opening…" : "Open in Buzz Desktop"}
          </Button>
        </div>
        <div className="mt-7 border-t border-black/8 pt-6 dark:border-white/8">
          <h3 className="text-sm font-semibold">Invite a teammate</h3>
          <p className="mt-2 text-sm leading-6 text-black/50 dark:text-white/45">
            Create a one-use link for this VarVik Studios community.
          </p>
          {inviteUrl ? (
            <button
              className="mt-3 w-full break-all rounded-xl bg-black/[0.045] p-3 text-left font-mono text-xs hover:bg-black/[0.07] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
              title="Copy invite link"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl).then(() => {
                  toast.success("Invite link copied");
                });
              }}
            >
              {inviteUrl}
            </button>
          ) : null}
          <Button
            className="mt-3"
            disabled={mintingInvite}
            variant="outline"
            onClick={() => {
              setMintingInvite(true);
              void mintBrowserInvite()
                .then((invite) => setInviteUrl(invite.url))
                .catch((error) => {
                  toast.error("Could not create an invite", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "Owner or admin access is required.",
                  });
                })
                .finally(() => setMintingInvite(false));
            }}
          >
            {mintingInvite ? "Creating…" : "Create invite link"}
          </Button>
        </div>
        <div className="mt-10 border-t border-black/8 pt-6 dark:border-white/8">
          <Button
            className="text-red-600 dark:text-red-400"
            variant="ghost"
            onClick={onSignOut}
          >
            <LogOut className="mr-2 size-4" />
            Lock and sign out
          </Button>
        </div>
      </section>
    </div>
  );
}

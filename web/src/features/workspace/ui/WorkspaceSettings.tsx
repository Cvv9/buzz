import {
  ArrowLeft,
  Bell,
  Check,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Sun,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { mintBrowserInvite } from "@/features/invite/invite-api";
import {
  type BrowserIdentity,
  exportBrowserIdentity,
} from "@/shared/lib/browser-identity";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  COMMUNITY_ACCENT_COLORS,
  type CommunityAppearance,
} from "@/shared/theme/community-theme";
import {
  type DesktopAppearanceMode,
  desktopThemeForMode,
  desktopThemePalette,
  desktopThemesForMode,
  formatDesktopThemeFamilyLabel,
  formatDesktopThemeLabel,
  isBuzzDesktopTheme,
} from "@/shared/theme/desktop-theme";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { Button } from "@/shared/ui/button";

const appearanceModes = [
  { mode: "system", label: "System", Icon: Monitor },
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
] as const;

const browserTools = [
  {
    href: "/preferences",
    label: "Notifications & accessibility",
    description: "Sound, motion, and browser text size",
  },
  {
    href: "/reminders",
    label: "Reminders",
    description: "Review encrypted message reminders",
  },
  {
    href: "/projects",
    label: "Projects & work items",
    description: "Browse project and repository activity",
  },
  {
    href: "/workflows",
    label: "Workflows",
    description: "Definitions, triggers, and approvals",
  },
  {
    href: "/offline",
    label: "Local archive",
    description: "Encrypted, browser-local channel archive",
  },
  {
    href: "/pairing",
    label: "Pair another browser",
    description: "Transfer this identity with confirmation",
  },
  {
    href: "/channel-state",
    label: "Saved channel state",
    description: "Muted, starred, pinned, and bookmarked items",
  },
  {
    href: "/moderation",
    label: "Moderation",
    description: "Community moderation tools for authorized members",
  },
  {
    href: "/identity-archive",
    label: "Identity archive",
    description: "Inspect identity state stored by the relay",
  },
] as const;

function activeAppearanceMode(
  appearance: CommunityAppearance,
  isDark: boolean,
): DesktopAppearanceMode {
  if (appearance.followSystem) return "system";
  return isDark ? "dark" : "light";
}

function themeOptionLabel(theme: string, mode: DesktopAppearanceMode): string {
  return mode === "system"
    ? formatDesktopThemeFamilyLabel(theme)
    : formatDesktopThemeLabel(theme);
}

function ThemePreview({ theme }: { theme: string }) {
  const palette = desktopThemePalette(theme);
  const background = palette.vars["--background"];
  const foreground = palette.vars["--foreground"];
  const sidebar = palette.vars["--sidebar-background"];
  return (
    <div
      aria-hidden="true"
      className="flex h-10 overflow-hidden rounded-md border border-border"
      style={{
        backgroundColor: `hsl(${background})`,
        color: `hsl(${foreground})`,
      }}
    >
      <span
        className="w-8 shrink-0"
        style={{ backgroundColor: `hsl(${sidebar})` }}
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5 px-3">
        <span className="size-1.5 rounded-full bg-current opacity-70" />
        <span className="h-1.5 w-16 rounded-full bg-current opacity-30" />
      </span>
    </div>
  );
}

function WorkspaceAppearanceSettings() {
  const { appearance, applyAppearance, isDark, selectedThemeName } = useTheme();
  const mode = activeAppearanceMode(appearance, isDark);
  const themes = desktopThemesForMode(mode);
  const selectedTheme = desktopThemeForMode(selectedThemeName, mode);
  const buzzTheme = isBuzzDesktopTheme(selectedThemeName);

  const updateAppearance = (next: Partial<CommunityAppearance>) => {
    applyAppearance({ ...appearance, ...next });
  };

  return (
    <section
      aria-labelledby="workspace-appearance-heading"
      className="mt-7 border-t border-border pt-6"
      data-testid="workspace-appearance-settings"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Palette className="size-4" />
        </span>
        <div>
          <h3
            className="text-sm font-semibold"
            id="workspace-appearance-heading"
          >
            Appearance
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Your theme is encrypted and synced with Buzz Desktop for this
            identity and community.
          </p>
        </div>
      </div>

      <fieldset className="mt-4 flex flex-wrap gap-2">
        <legend className="sr-only">Appearance mode</legend>
        {appearanceModes.map(({ mode: optionMode, label, Icon }) => {
          const selected = mode === optionMode;
          return (
            <button
              aria-pressed={selected}
              className={
                selected
                  ? "inline-flex items-center gap-2 rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-foreground outline-none ring-1 ring-primary/20"
                  : "inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              }
              data-testid={`appearance-mode-${optionMode}`}
              key={optionMode}
              type="button"
              onClick={() =>
                updateAppearance({
                  followSystem: optionMode === "system",
                  theme: desktopThemeForMode(selectedThemeName, optionMode),
                })
              }
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </fieldset>

      <label
        className="mt-5 block text-sm font-medium"
        htmlFor="workspace-theme-family"
      >
        Theme family
      </label>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
        <select
          className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="workspace-theme-family"
          id="workspace-theme-family"
          value={selectedTheme}
          onChange={(event) =>
            updateAppearance({
              theme: event.target.value,
              followSystem: mode === "system",
            })
          }
        >
          {themes.map((theme) => (
            <option key={theme} value={theme}>
              {themeOptionLabel(theme, mode)}
            </option>
          ))}
        </select>
        <ThemePreview theme={selectedTheme} />
      </div>

      {buzzTheme ? (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Buzz uses its neutral accent to preserve the desktop sidebar
          treatment.
        </p>
      ) : (
        <div className="mt-5">
          <h4 className="text-sm font-medium">Accent color</h4>
          <div className="mt-2 flex flex-wrap gap-2 p-1">
            {COMMUNITY_ACCENT_COLORS.map((color) => {
              const selected = appearance.accent === color.value;
              const neutral = color.value === "neutral";
              return (
                <button
                  aria-label={`Use ${color.name} accent`}
                  aria-pressed={selected}
                  className={
                    selected
                      ? "flex size-7 items-center justify-center rounded-full border border-border ring-2 ring-ring ring-offset-2 ring-offset-background"
                      : "flex size-7 items-center justify-center rounded-full border border-border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  }
                  data-testid={`appearance-accent-${color.name.toLowerCase()}`}
                  key={color.value}
                  style={{
                    backgroundColor: neutral
                      ? "hsl(var(--foreground))"
                      : color.value,
                  }}
                  title={color.name}
                  type="button"
                  onClick={() => updateAppearance({ accent: color.value })}
                >
                  {selected ? (
                    <Check
                      className={`size-4 ${neutral && isDark ? "text-black" : "text-white"}`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

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
    <main className="min-h-[100dvh] bg-background text-foreground lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="border-b border-border bg-sidebar px-4 py-5 text-sidebar-foreground lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <button
          className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          type="button"
          onClick={onClose}
        >
          <ArrowLeft className="size-4" /> Back to app
        </button>
        <SettingsNavigation identity={identity} />
      </aside>
      <section className="mx-auto w-full max-w-5xl px-5 py-7 sm:px-8 lg:px-12 lg:py-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Personal</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Settings
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Browser-safe preferences that sync with Buzz where supported.
            </p>
          </div>
        </header>

        <WorkspaceAppearanceSettings />

        <section
          aria-labelledby="workspace-browser-tools-heading"
          className="mt-7 border-t border-border pt-6"
          data-testid="workspace-browser-tools"
        >
          <h3
            className="text-sm font-semibold"
            id="workspace-browser-tools-heading"
          >
            Web tools
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Browser-safe settings and management pages available in Buzz Web.
          </p>
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {browserTools.map((tool) => (
              <a
                className="block px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                data-testid={`workspace-tool-${tool.href.slice(1)}`}
                href={tool.href}
                key={tool.href}
              >
                <span className="block text-sm font-medium">{tool.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {tool.description}
                </span>
              </a>
            ))}
          </div>
        </section>

        <div className="mt-7 rounded-2xl border border-border p-4">
          <p className="font-medium">{identity.displayName}</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {identity.pubkey}
          </p>
        </div>
        <div className="mt-7">
          <h3 className="text-sm font-semibold">Recovery key</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Save this private key in a password manager. Anyone who has it can
            act as you.
          </p>
          {backup ? (
            <div className="mt-3 break-all rounded-xl bg-muted p-3 font-mono text-xs">
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
        <div className="mt-7 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Browser notifications</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
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
        <div className="mt-7 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Buzz Desktop</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
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
        <div className="mt-7 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Invite a teammate</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create a one-use link for this VarVik Studios community.
          </p>
          {inviteUrl ? (
            <button
              className="mt-3 w-full break-all rounded-xl bg-muted p-3 text-left font-mono text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <div className="mt-10 border-t border-border pt-6">
          <Button
            className="text-destructive"
            variant="ghost"
            onClick={onSignOut}
          >
            <LogOut className="mr-2 size-4" />
            Lock and sign out
          </Button>
        </div>
      </section>
    </main>
  );
}

function SettingsNavigation({ identity }: { identity: BrowserIdentity }) {
  const groups = [
    {
      label: "Personal",
      entries: [
        { href: `/profiles/${identity.pubkey}`, label: "Profile" },
        { href: "#workspace-appearance-heading", label: "Appearance" },
        { href: "/preferences", label: "Notifications & accessibility" },
        { href: "/reminders", label: "Reminders" },
        { href: "/custom-emoji", label: "Custom emoji" },
      ],
    },
    {
      label: "Workspace",
      entries: [
        { href: "/?view=agents", label: "Agents" },
        { href: "/workflows", label: "Workflows" },
        { href: "/projects", label: "Projects & work items" },
        { href: "/channel-state", label: "Saved channel state" },
      ],
    },
    {
      label: "Browser & data",
      entries: [
        { href: "/offline", label: "Local archive" },
        { href: "/pairing", label: "Pair another browser" },
        { href: "/identity-archive", label: "Identity archive" },
        { href: "/moderation", label: "Moderation" },
      ],
    },
  ];
  return (
    <nav className="mt-6 grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-2 text-xs font-semibold text-muted-foreground">
            {group.label}
          </p>
          <div className="mt-1 space-y-0.5">
            {group.entries.map((entry) => (
              <a
                className="block rounded-lg px-2 py-2 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                href={entry.href}
                key={entry.href}
              >
                {entry.label}
              </a>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

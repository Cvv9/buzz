import {
  Bot,
  ChevronRight,
  CirclePlus,
  Database,
  Image,
  LockKeyhole,
  Pencil,
  Save,
  Users,
  X,
} from "lucide-react";
import * as React from "react";
import { uploadBrowserMedia } from "@/features/media/browser-media";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";
import type { WorkspaceChannel, WorkspaceProfile } from "../workspace-api";
import { groupWorkspaceAgentChannels } from "../workspace-agent-access-policy";
import type {
  WorkspaceAgentModelFamily,
  WorkspaceReasoningEffort,
} from "../workspace-agent-models";
import type { HostedAgentUpdate } from "../workspace-hosted-agent-update-policy";
import {
  agentAccessLabel as accessLabel,
  agentRoleLabel,
} from "../agent-presentation";
import { ProfileAvatar } from "./WorkspaceSidebar";

type Props = {
  agents: readonly WorkspaceProfile[];
  channels: readonly WorkspaceChannel[];
  canManage: boolean;
  busy?: boolean;
  error?: string | null;
  onSetChannelAccess: (
    agent: WorkspaceProfile,
    channel: WorkspaceChannel,
    enabled: boolean,
  ) => Promise<void>;
  onUpdateAgent: (
    agent: WorkspaceProfile,
    update: HostedAgentUpdate,
  ) => Promise<void>;
};

export function WorkspaceAgents({
  agents,
  channels,
  canManage,
  busy = false,
  error,
  onSetChannelAccess,
  onUpdateAgent,
}: Props) {
  const [selectedPubkey, setSelectedPubkey] = React.useState<string | null>(
    agents[0]?.pubkey ?? null,
  );
  const [editing, setEditing] = React.useState(false);
  const [showProvisioning, setShowProvisioning] = React.useState(false);
  const selected =
    agents.find((agent) => agent.pubkey === selectedPubkey) ??
    agents[0] ??
    null;

  React.useEffect(() => {
    if (selected && selected.pubkey !== selectedPubkey) {
      setSelectedPubkey(selected.pubkey);
    }
  }, [selected, selectedPubkey]);

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="workspace-agents"
    >
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-black/8 px-4 py-3 dark:border-white/8 sm:px-6">
        <Bot className="size-4 shrink-0 text-black/40 dark:text-white/35" />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Agents</h1>
          <p className="truncate text-xs text-black/40 dark:text-white/35">
            Understand responsibilities, resources, and channel access.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setShowProvisioning(true)}>
            <CirclePlus />
            New agent
          </Button>
        ) : null}
      </header>

      {agents.length && selected ? (
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(15rem,0.72fr)_minmax(24rem,1.28fr)]">
          <div className="min-h-0 overflow-y-auto border-b border-black/8 p-3 dark:border-white/8 md:border-r md:border-b-0">
            <div className="space-y-1">
              {agents.map((agent) => {
                const isSelected = agent.pubkey === selected.pubkey;
                return (
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      isSelected
                        ? "bg-black/7 dark:bg-white/8"
                        : "hover:bg-black/4 dark:hover:bg-white/5",
                    )}
                    data-testid={`agent-row-${agent.name.toLowerCase().replace(/ /g, "-")}`}
                    key={agent.pubkey}
                    type="button"
                    onClick={() => {
                      setSelectedPubkey(agent.pubkey);
                      setEditing(false);
                    }}
                  >
                    <ProfileAvatar profile={agent} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {agent.name} — {agentRoleLabel(agent)}
                      </span>
                      <span className="block truncate text-xs text-black/40 dark:text-white/35">
                        {accessLabel(agent)}
                      </span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-4",
                        isSelected
                          ? "text-black/55 dark:text-white/55"
                          : "text-black/20 dark:text-white/20",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5 sm:p-7">
            {editing ? (
              <AgentEditForm
                agent={selected}
                busy={busy}
                error={error}
                onCancel={() => setEditing(false)}
                onSave={async (update) => {
                  await onUpdateAgent(selected, update);
                  setEditing(false);
                }}
              />
            ) : (
              <AgentDetails
                agent={selected}
                busy={busy}
                canManage={canManage}
                channels={channels}
                error={error}
                onEdit={() => setEditing(true)}
                onSetChannelAccess={onSetChannelAccess}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-72 items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#d7d72e]/25 text-[#7d7e00]">
              <Users className="size-5" />
            </div>
            <h2 className="mt-4 font-semibold">No hosted agents connected</h2>
            <p className="mt-2 text-sm leading-6 text-black/45 dark:text-white/40">
              A hosted runner must connect and publish its signed profile before
              it can be managed here.
            </p>
            {canManage ? (
              <Button
                className="mt-4"
                size="sm"
                onClick={() => setShowProvisioning(true)}
              >
                <CirclePlus /> New agent
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {showProvisioning ? (
        <ProvisioningDialog onClose={() => setShowProvisioning(false)} />
      ) : null}
    </section>
  );
}

function AgentDetails({
  agent,
  busy,
  canManage,
  channels,
  error,
  onEdit,
  onSetChannelAccess,
}: {
  agent: WorkspaceProfile;
  busy: boolean;
  canManage: boolean;
  channels: readonly WorkspaceChannel[];
  error?: string | null;
  onEdit: () => void;
  onSetChannelAccess: Props["onSetChannelAccess"];
}) {
  const [channelSearch, setChannelSearch] = React.useState("");
  const accessGroups = React.useMemo(
    () => groupWorkspaceAgentChannels(channels, channelSearch),
    [channelSearch, channels],
  );
  const currentRuntime = agent.runtime?.effective;
  const currentFamily = agent.modelFamilies?.find(
    (family) => family.id === currentRuntime?.model,
  );
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start gap-4">
        <ProfileAvatar profile={agent} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold tracking-tight">
            {agent.name} — {agentRoleLabel(agent)}
          </h2>
          <p className="mt-1 text-xs text-black/45 dark:text-white/40">
            {accessLabel(agent)}
            {currentRuntime
              ? ` · ${currentFamily?.name ?? currentRuntime.model} · ${effortLabel(currentRuntime.effort)}`
              : agent.model
                ? ` · ${agent.model}`
                : ""}
          </p>
        </div>
        <Button
          disabled={!canManage || busy}
          size="sm"
          variant="outline"
          onClick={onEdit}
        >
          <Pencil /> Edit profile
        </Button>
      </div>

      {agent.runtime ? <AgentRuntimeStatus agent={agent} /> : null}
      {!canManage ? (
        <p className="mt-4 rounded-xl border border-black/8 bg-black/2 p-3 text-xs leading-5 text-black/50 dark:border-white/8 dark:bg-white/3 dark:text-white/45">
          Only the current community owner can change hosted agents.
        </p>
      ) : null}

      <section className="mt-7 border-t border-black/8 pt-5 dark:border-white/8">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-black/45 dark:text-white/40">
          What this agent does
        </h3>
        <p className="mt-2 text-sm leading-6 text-black/70 dark:text-white/68">
          {agent.about ||
            "This agent has not published a responsibility description yet."}
        </p>
      </section>

      <section className="mt-6 border-t border-black/8 pt-5 dark:border-white/8">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-black/40 dark:text-white/35" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-black/45 dark:text-white/40">
            Connected resources
          </h3>
        </div>
        {agent.resources?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {agent.resources.map((resource) => (
              <span
                className="rounded-full border border-black/8 bg-black/3 px-2.5 py-1 text-xs dark:border-white/8 dark:bg-white/5"
                key={resource}
              >
                {resource}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-black/45 dark:text-white/40">
            No external resources have been declared by this agent runtime.
          </p>
        )}
        <p className="mt-3 text-xs leading-5 text-black/38 dark:text-white/35">
          External credentials are granted by the agent runner, never by profile
          editing.
        </p>
      </section>

      <section className="mt-6 border-t border-black/8 pt-5 dark:border-white/8">
        <div className="flex items-center gap-2">
          <LockKeyhole className="size-4 text-black/40 dark:text-white/35" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-black/45 dark:text-white/40">
            Channel access
          </h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-black/45 dark:text-white/40">
          Membership is shared with the channel catalog. Search by channel,
          description, or catalog section.
        </p>
        <Input
          aria-label={`Find a channel for ${agent.name}`}
          className="mt-3"
          placeholder="Find a channel"
          type="search"
          value={channelSearch}
          onChange={(event) => setChannelSearch(event.target.value)}
        />
        {agent.accessTier === "personal" ? (
          <p className="mt-3 rounded-xl border border-black/8 bg-black/2 p-3 text-xs leading-5 text-black/50 dark:border-white/8 dark:bg-white/3 dark:text-white/45">
            Personal agents are private to their owner, so their channel access
            cannot be changed here.
          </p>
        ) : accessGroups.length ? (
          <div className="mt-3 space-y-4">
            {accessGroups.map((group) => (
              <section key={group.label}>
                <h4 className="px-1 text-xs font-semibold text-black/50 dark:text-white/45">
                  {group.label}
                </h4>
                <div className="mt-1 divide-y divide-black/6 overflow-hidden rounded-xl border border-black/8 dark:divide-white/6 dark:border-white/8">
                  {group.channels.map((channel) => {
                    const enabled = channel.memberPubkeys.includes(
                      agent.pubkey,
                    );
                    return (
                      <label
                        className="flex items-center gap-3 px-3 py-2.5"
                        key={channel.id}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            #{channel.name}
                          </span>
                          {channel.about ? (
                            <span className="mt-0.5 block truncate text-xs text-black/40 dark:text-white/35">
                              {channel.about}
                            </span>
                          ) : null}
                        </span>
                        <input
                          aria-label={`${channel.name} access for ${agent.name}`}
                          checked={enabled}
                          className="size-4 accent-black dark:accent-white"
                          disabled={!canManage || busy}
                          type="checkbox"
                          onChange={(event) =>
                            void onSetChannelAccess(
                              agent,
                              channel,
                              event.target.checked,
                            )
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-black/10 p-4 text-sm text-black/45 dark:border-white/10 dark:text-white/40">
            No channels match “{channelSearch.trim()}”.
          </p>
        )}
        {error ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </section>
    </div>
  );
}

function AgentEditForm({
  agent,
  busy,
  error,
  onCancel,
  onSave,
}: {
  agent: WorkspaceProfile;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (update: HostedAgentUpdate) => Promise<void>;
}) {
  const baselineRuntime = agent.runtime?.pending ?? agent.runtime?.effective;
  const [name, setName] = React.useState(agent.name);
  const [avatarUrl, setAvatarUrl] = React.useState(agent.picture ?? "");
  const [model, setModel] = React.useState(baselineRuntime?.model ?? "");
  const [effort, setEffort] = React.useState<WorkspaceReasoningEffort | "">(
    baselineRuntime?.effort ?? "",
  );
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(
    null,
  );
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const selectedFamily = agent.modelFamilies?.find(
    (family) => family.id === model,
  );
  const runtimeManaged = Boolean(agent.runtime);
  const runtimeVerified = Boolean(
    runtimeManaged &&
      agent.runtimeStatusTrusted &&
      agent.runtimeCatalogDigest &&
      agent.runtimeControllerPubkey &&
      agent.modelFamilies?.length,
  );
  const nameChanged = name.trim() !== agent.name.trim();
  const runtimeSelectionChanged = Boolean(
    runtimeManaged &&
      baselineRuntime &&
      (model !== baselineRuntime.model || effort !== baselineRuntime.effort),
  );
  const runtimeWriteNeeded = Boolean(
    runtimeManaged && (nameChanged || runtimeSelectionChanged),
  );
  const runtimeSelectionValid = Boolean(
    selectedFamily &&
      effort &&
      selectedFamily.efforts.includes(effort as WorkspaceReasoningEffort),
  );
  const canSaveRuntime =
    !runtimeWriteNeeded || (runtimeVerified && runtimeSelectionValid);
  return (
    <form
      className="mx-auto max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          name,
          avatarUrl: avatarUrl || null,
          model: runtimeManaged ? model || null : null,
          effort: runtimeManaged
            ? (effort as WorkspaceReasoningEffort) || null
            : null,
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Edit {agent.name}</h2>
          <p className="mt-1 text-xs text-black/45 dark:text-white/40">
            Changes are signed and shared across web and desktop.
          </p>
        </div>
        <Button
          aria-label="Cancel editing"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>
      <div className="mt-6 space-y-5">
        <label className="block text-sm font-medium" htmlFor="agent-name">
          Name
          <Input
            id="agent-name"
            className="mt-2"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="block text-sm font-medium">
          <span className="inline-flex items-center gap-2">
            <Image className="size-4" /> Profile picture
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
              {uploadProgress === null
                ? "Choose picture"
                : `Uploading ${uploadProgress}%`}
              <input
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="sr-only"
                disabled={uploadProgress !== null}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setUploadError(null);
                  setUploadProgress(0);
                  void uploadBrowserMedia(file, {
                    onProgress: setUploadProgress,
                  })
                    .then((media) => setAvatarUrl(media.url))
                    .catch((nextError) =>
                      setUploadError(
                        nextError instanceof Error
                          ? nextError.message
                          : "The picture could not be uploaded.",
                      ),
                    )
                    .finally(() => setUploadProgress(null));
                }}
              />
            </label>
            {avatarUrl ? (
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => setAvatarUrl("")}
              >
                Remove picture
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            JPG, PNG, GIF, or WebP. The relay stores it securely and the saved
            media URL syncs across Buzz clients.
          </p>
          {uploadError ? (
            <p className="mt-2 text-xs text-destructive">{uploadError}</p>
          ) : null}
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="agent-model">
            Model
          </label>
          <select
            id="agent-model"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            disabled={!runtimeVerified}
            value={model}
            onChange={(event) => {
              const nextModel = event.target.value;
              const nextFamily = agent.modelFamilies?.find(
                (family) => family.id === nextModel,
              );
              setModel(nextModel);
              if (
                nextFamily &&
                (!effort ||
                  !nextFamily.efforts.includes(
                    effort as WorkspaceReasoningEffort,
                  ))
              ) {
                setEffort(nextFamily.defaultEffort);
              }
            }}
          >
            {!model ? <option value="">Unavailable</option> : null}
            {agent.modelFamilies?.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
            {model &&
            !agent.modelFamilies?.some((family) => family.id === model) ? (
              <option value={model}>{model}</option>
            ) : null}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            {selectedFamily?.description ||
              "Models come from this agent's signed runtime catalog."}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="agent-effort">
            Reasoning effort
          </label>
          <select
            id="agent-effort"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            disabled={!runtimeVerified || !selectedFamily}
            value={effort}
            onChange={(event) =>
              setEffort(event.target.value as WorkspaceReasoningEffort)
            }
          >
            {!effort ? <option value="">Unavailable</option> : null}
            {selectedFamily?.efforts.map((option) => (
              <option key={option} value={option}>
                {effortLabel(option)}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            Model and effort are saved together as this agent&apos;s default for
            every new task. An active task keeps its current runtime until it
            finishes.
          </p>
        </div>
        {runtimeManaged && !runtimeVerified ? (
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
            Runtime changes are disabled because the controller status or the
            agent&apos;s signed model catalog cannot be verified. Refresh and
            try again.
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="mt-4 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button
          disabled={busy}
          type="button"
          variant="ghost"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          disabled={busy || !name.trim() || !canSaveRuntime}
          type="submit"
        >
          <Save /> {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function effortLabel(effort: WorkspaceReasoningEffort): string {
  return (
    {
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra high",
      max: "Max",
      ultra: "Ultra",
    } satisfies Record<WorkspaceReasoningEffort, string>
  )[effort];
}

function runtimeFamily(
  agent: WorkspaceProfile,
  model: string,
): WorkspaceAgentModelFamily | undefined {
  return agent.modelFamilies?.find((family) => family.id === model);
}

function AgentRuntimeStatus({ agent }: { agent: WorkspaceProfile }) {
  const runtime = agent.runtime;
  if (!runtime) return null;
  const selection = runtime.pending ?? runtime.effective;
  const family = runtimeFamily(agent, selection.model);
  const message =
    runtime.state === "pending_busy"
      ? "Queued — applies after current work finishes"
      : runtime.state === "applying"
        ? "Applying to new sessions"
        : runtime.state === "applied"
          ? "Applied"
          : runtime.state === "failed"
            ? (runtime.error?.message ??
              "The runtime change failed. Try again.")
            : "Current";
  return (
    <div
      className={cn(
        "mt-4 rounded-xl border p-3 text-xs leading-5",
        runtime.state === "failed"
          ? "border-red-500/25 bg-red-500/8 text-red-700 dark:text-red-300"
          : "border-black/8 bg-black/2 text-black/55 dark:border-white/8 dark:bg-white/3 dark:text-white/50",
      )}
      data-testid="agent-runtime-status"
    >
      <span className="font-semibold">{message}</span>
      <span className="block">
        {family?.name ?? selection.model} · {effortLabel(selection.effort)}
      </span>
    </div>
  );
}

function ProvisioningDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="presentation"
    >
      <div
        aria-labelledby="new-agent-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-black/10 bg-background p-6 shadow-2xl dark:border-white/10"
        role="dialog"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#d7d72e]/25 text-[#727300]">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold" id="new-agent-title">
              Connect a new agent
            </h2>
            <p className="mt-2 text-sm leading-6 text-black/55 dark:text-white/50">
              Agent runtimes hold credentials and tools, so they must first be
              provisioned by the hosted runner. Once its signed profile appears
              here, you can edit its identity and assign channel access.
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-xl border border-black/8 bg-black/3 p-4 text-xs leading-5 text-black/55 dark:border-white/8 dark:bg-white/4 dark:text-white/50">
          The Opportunity Scout, Bid &amp; Partnerships Desk, and GTM &amp;
          Customer Discovery runners are included in the deployment
          configuration.
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Got it</Button>
        </div>
      </div>
    </div>
  );
}

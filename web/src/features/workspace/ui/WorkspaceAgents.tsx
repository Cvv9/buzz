import {
  Bot,
  Check,
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
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";
import type { WorkspaceChannel, WorkspaceProfile } from "../workspace-api";
import { ProfileAvatar } from "./WorkspaceSidebar";

function accessLabel(agent: WorkspaceProfile) {
  if (agent.accessTier === "personal") return "Private to you";
  if (agent.accessTier === "admin") return "Admins only";
  return "Available to everyone";
}

type AgentUpdate = {
  name: string;
  avatarUrl: string | null;
  model: string | null;
};

type Props = {
  activeChannel: WorkspaceChannel | null;
  agents: readonly WorkspaceProfile[];
  channels: readonly WorkspaceChannel[];
  canManage: boolean;
  busy?: boolean;
  error?: string | null;
  onAddAgent: (agent: WorkspaceProfile) => void;
  onSetChannelAccess: (
    agent: WorkspaceProfile,
    channel: WorkspaceChannel,
    enabled: boolean,
  ) => Promise<void>;
  onUpdateAgent: (
    agent: WorkspaceProfile,
    update: AgentUpdate,
  ) => Promise<void>;
};

export function WorkspaceAgents({
  activeChannel,
  agents,
  channels,
  canManage,
  busy = false,
  error,
  onAddAgent,
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
                        {agent.name}
                      </span>
                      <span className="block truncate text-xs text-black/40 dark:text-white/35">
                        {agent.about || accessLabel(agent)}
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
                activeChannel={activeChannel}
                agent={selected}
                busy={busy}
                canManage={canManage}
                channels={channels}
                error={error}
                onAddAgent={onAddAgent}
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
  activeChannel,
  agent,
  busy,
  canManage,
  channels,
  error,
  onAddAgent,
  onEdit,
  onSetChannelAccess,
}: {
  activeChannel: WorkspaceChannel | null;
  agent: WorkspaceProfile;
  busy: boolean;
  canManage: boolean;
  channels: readonly WorkspaceChannel[];
  error?: string | null;
  onAddAgent: (agent: WorkspaceProfile) => void;
  onEdit: () => void;
  onSetChannelAccess: Props["onSetChannelAccess"];
}) {
  const isInActiveChannel = Boolean(
    activeChannel?.memberPubkeys.includes(agent.pubkey),
  );
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start gap-4">
        <ProfileAvatar profile={agent} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold tracking-tight">
            {agent.name}
          </h2>
          <p className="mt-1 text-xs text-black/45 dark:text-white/40">
            {accessLabel(agent)}
            {agent.model ? ` · ${agent.model}` : ""}
          </p>
        </div>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil /> Edit profile
          </Button>
        ) : null}
      </div>

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

      {activeChannel && agent.accessTier !== "personal" ? (
        <div className="mt-6 rounded-xl border border-black/8 bg-black/2 p-4 dark:border-white/8 dark:bg-white/3">
          <p className="text-sm font-medium">Current channel</p>
          <p className="mt-1 text-xs text-black/45 dark:text-white/40">
            {isInActiveChannel
              ? `${agent.name} can participate in #${activeChannel.name}.`
              : `${agent.name} does not have access to #${activeChannel.name}.`}
          </p>
          {!isInActiveChannel ? (
            <Button
              className="mt-3"
              disabled={busy}
              size="sm"
              onClick={() => onAddAgent(agent)}
            >
              <Check /> Add to #{activeChannel.name}
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="mt-6 border-t border-black/8 pt-5 dark:border-white/8">
        <div className="flex items-center gap-2">
          <LockKeyhole className="size-4 text-black/40 dark:text-white/35" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-black/45 dark:text-white/40">
            Channel access
          </h3>
        </div>
        <div className="mt-3 divide-y divide-black/6 overflow-hidden rounded-xl border border-black/8 dark:divide-white/6 dark:border-white/8">
          {channels.map((channel) => {
            const enabled = channel.memberPubkeys.includes(agent.pubkey);
            return (
              <label
                className="flex items-center gap-3 px-3 py-2.5"
                key={channel.id}
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  #{channel.name}
                </span>
                <input
                  aria-label={`${channel.name} access for ${agent.name}`}
                  checked={enabled}
                  className="size-4 accent-black dark:accent-white"
                  disabled={
                    !canManage || busy || agent.accessTier === "personal"
                  }
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
  onSave: (update: AgentUpdate) => Promise<void>;
}) {
  const [name, setName] = React.useState(agent.name);
  const [avatarUrl, setAvatarUrl] = React.useState(agent.picture ?? "");
  const [model, setModel] = React.useState(agent.model ?? "");
  return (
    <form
      className="mx-auto max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          name,
          avatarUrl: avatarUrl || null,
          model: model || null,
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
        <label className="block text-sm font-medium" htmlFor="agent-avatar-url">
          <span className="inline-flex items-center gap-2">
            <Image className="size-4" /> Profile picture URL
          </span>
          <Input
            id="agent-avatar-url"
            className="mt-2"
            placeholder="https://…"
            type="url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium" htmlFor="agent-model">
          Model
          <Input
            id="agent-model"
            className="mt-2"
            placeholder="Runtime default"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
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
        <Button disabled={busy || !name.trim()} type="submit">
          <Save /> {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
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

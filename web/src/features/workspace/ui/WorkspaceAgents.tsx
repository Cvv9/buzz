import { Bot, Check, Plus, Users } from "lucide-react";
import type { WorkspaceChannel, WorkspaceProfile } from "../workspace-api";
import { ProfileAvatar } from "./WorkspaceSidebar";

function accessLabel(agent: WorkspaceProfile) {
  if (agent.accessTier === "personal") return "Private to you";
  if (agent.accessTier === "admin") return "Admins only";
  return "Available to everyone";
}

export function WorkspaceAgents({
  activeChannel,
  agents,
  onAddAgent,
}: {
  activeChannel: WorkspaceChannel | null;
  agents: readonly WorkspaceProfile[];
  onAddAgent: (agent: WorkspaceProfile) => void;
}) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="workspace-agents"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-black/8 px-4 dark:border-white/8 sm:px-6">
        <Bot className="size-4 shrink-0 text-black/40 dark:text-white/35" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">Agents</h1>
          <p className="truncate text-xs text-black/40 dark:text-white/35">
            Hosted teammates available in this workspace.
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {agents.length ? (
          <div className="mx-auto max-w-3xl divide-y divide-black/8 overflow-hidden rounded-2xl border border-black/8 dark:divide-white/8 dark:border-white/8">
            {agents.map((agent) => {
              const isPersonal = agent.accessTier === "personal";
              const isMember = Boolean(
                activeChannel?.memberPubkeys.includes(agent.pubkey),
              );
              return (
                <div
                  className="flex items-center gap-3 px-4 py-3"
                  key={agent.pubkey}
                >
                  <ProfileAvatar profile={agent} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{agent.name}</p>
                    <p className="text-xs text-black/40 dark:text-white/35">
                      {accessLabel(agent)}
                    </p>
                  </div>
                  {activeChannel && !isPersonal ? (
                    isMember ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                        <Check className="size-3.5" />
                        In #{activeChannel.name}
                      </span>
                    ) : (
                      <button
                        aria-label={`Add ${agent.name} to ${activeChannel.name}`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-black/60 hover:bg-black/5 dark:text-white/55 dark:hover:bg-white/5"
                        type="button"
                        onClick={() => onAddAgent(agent)}
                      >
                        <Plus className="size-3.5" />
                        Add to #{activeChannel.name}
                      </button>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-72 items-center justify-center px-6 text-center">
            <div className="max-w-sm">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#d7d72e]/25 text-[#7d7e00]">
                <Users className="size-5" />
              </div>
              <h2 className="mt-4 font-semibold">No hosted agents online</h2>
              <p className="mt-2 text-sm leading-6 text-black/45 dark:text-white/40">
                Agents will appear here when a hosted runner connects to this
                workspace.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

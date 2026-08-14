import {
  Bot,
  BookOpen,
  CheckCircle2,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  type LucideIcon,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceProfile } from "@/features/workspace/workspace-api";

const AGENT_HELP: Record<string, { purpose: string; example: string }> = {
  "Project Brain": {
    purpose:
      "Source-backed answers about projects, architecture, dependencies, timelines, deployments, and risks.",
    example:
      "@Project Brain explain the current FactoryOS architecture and identify stale evidence.",
  },
  "Market Intelligence": {
    purpose:
      "On-demand market, competitor, customer, pricing, regulation, and opportunity research.",
    example:
      "@Market Intelligence compare these competitors and tell us what decision the evidence supports.",
  },
  "Founder Chief of Staff": {
    purpose:
      "Varun's private coordinator for priorities, decisions, approvals, and bounded Sylars handoffs.",
    example:
      "@Founder Chief of Staff turn this discussion into a proposed Sylars task, but show me the scope first.",
  },
  "Operations Desk": {
    purpose:
      "Private Watchdog, CI, and observability intake with Sylars task status and approval-aware routing.",
    example:
      "@Operations Desk group these alerts, explain the likely shared cause, and propose a read-only triage task.",
  },
  "Trend Radar": {
    purpose:
      "A periodic cross-topic briefing containing only the most important market and technology signals.",
    example: "Open the trends channel for the latest Trend Radar briefing.",
  },
};

function accessLabel(agent: WorkspaceProfile): string {
  if (agent.accessTier === "personal") return "Private to you";
  if (agent.accessTier === "admin") return "Varun only";
  return "Everyone";
}

export function WorkspaceGuide({
  agents,
  onClose,
}: {
  agents: WorkspaceProfile[];
  onClose: () => void;
}) {
  const callableAgents = agents.filter(
    (agent) => agent.accessTier !== "personal",
  );
  const companion = agents.find((agent) => agent.accessTier === "personal");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
      <button
        aria-label="Close Buzz Guide"
        className="absolute inset-0"
        type="button"
        onClick={onClose}
      />
      <section
        aria-labelledby="buzz-guide-title"
        aria-modal="true"
        className="relative h-full w-full max-w-2xl overflow-y-auto bg-[#f7f8f2] p-6 shadow-2xl dark:bg-[#1b1e19]"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-black/40 dark:text-white/35">
              <BookOpen className="size-3.5" />
              VarVik Studios rulebook
            </div>
            <h2 className="mt-1 text-xl font-semibold" id="buzz-guide-title">
              Using Buzz and its agents
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-black/50 dark:text-white/45">
              A practical guide for asking agents for help, keeping work in the
              right place, and understanding when approval is required.
            </p>
          </div>
          <button
            aria-label="Close Buzz Guide"
            className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
            type="button"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <GuideSection icon={MessageSquareText} title="Call an agent">
          <ol className="space-y-3 text-sm leading-6 text-black/60 dark:text-white/55">
            <li>
              <strong>1.</strong> Open the channel where the work belongs.
            </li>
            <li>
              <strong>2.</strong> Mention an available hosted agent and Buzz
              adds it to that channel automatically. Use the + beside an agent
              only when you want to add it before the first mention.
            </li>
            <li>
              <strong>3.</strong> Start your message with its exact name,
              including the @ sign—for example:{" "}
              <Code>@Project Brain explain this project's architecture</Code>.
            </li>
            <li>
              <strong>4.</strong> Include the outcome, context, constraints, and
              deadline.
            </li>
          </ol>
          <div className="mt-4 rounded-xl bg-[#d7d72e]/15 p-4 text-sm leading-6 text-black/65 dark:text-white/60">
            <strong>Good request:</strong> “@Market Intelligence compare these
            three vendors, use sources from this year, and give me a short
            recommendation by 4 PM.”
          </div>
        </GuideSection>

        <GuideSection icon={Bot} title="Agents available to you">
          {callableAgents.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {callableAgents.map((agent) => {
                const help = AGENT_HELP[agent.name];
                return (
                  <article
                    className="rounded-xl border border-black/8 p-4 dark:border-white/8"
                    key={agent.pubkey}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-medium">{agent.name}</h4>
                      <span className="shrink-0 rounded-full bg-black/5 px-2 py-1 text-xs text-black/45 dark:bg-white/6 dark:text-white/40">
                        {accessLabel(agent)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-5 text-black/50 dark:text-white/45">
                      {help?.purpose ?? agent.about ?? "Hosted assistant"}
                    </p>
                    <Code className="mt-3 block">
                      {help?.example ??
                        `@${agent.name} help me with this task.`}
                    </Code>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-black/50 dark:text-white/45">
              Hosted agents will appear here when their runners are connected.
            </p>
          )}
        </GuideSection>

        <GuideSection
          icon={LockKeyhole}
          title="Private companions and daily briefs"
        >
          <p className="text-sm leading-6 text-black/55 dark:text-white/50">
            {companion
              ? `${companion.name} works only for you. `
              : "Each team member has a private Companion. "}
            Use your private brief channel (for example <Code>brief-varun</Code>
            ) for assigned work, reminders, mentions, and your morning summary.
            The Companion must not post that personal information into general
            or project channels.
          </p>
        </GuideSection>

        <GuideSection icon={ShieldCheck} title="Safety and approvals">
          <ul className="space-y-3 text-sm leading-6 text-black/55 dark:text-white/50">
            <Rule>
              Agents begin with read-only investigation and explain what they
              want to do in simple language.
            </Rule>
            <Rule>
              They may prepare plans, summaries, isolated code changes, tests,
              and draft pull requests.
            </Rule>
            <Rule>
              They may not delete repositories or data, force-push, merge,
              deploy, stop services, or change production without Varun's
              explicit approval.
            </Rule>
            <Rule>
              If a tool is not connected, the agent must say so instead of
              pretending it completed the work.
            </Rule>
          </ul>
        </GuideSection>
      </section>
    </div>
  );
}

function GuideSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-black/8 pt-6 dark:border-white/8">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-[#969600]" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Code({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code
      className={`rounded-md bg-black/6 px-1.5 py-1 text-xs text-black/65 dark:bg-white/7 dark:text-white/60 ${className ?? ""}`}
    >
      {children}
    </code>
  );
}

function Rule({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span>{children}</span>
    </li>
  );
}

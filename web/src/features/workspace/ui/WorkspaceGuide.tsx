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
  "VarVik Guide": {
    purpose:
      "Planning, summaries, coordination, and finding the right specialist.",
    example:
      "@VarVik Guide summarize this discussion and list the next actions.",
  },
  "VarVik Engineer": {
    purpose:
      "Architecture, debugging, implementation, tests, and release readiness.",
    example: "@VarVik Engineer investigate this bug and propose a safe fix.",
  },
  "VarVik Creative": {
    purpose: "Product design, UX, brand, writing, and creative feedback.",
    example: "@VarVik Creative improve this onboarding copy and explain why.",
  },
  "VarVik Research": {
    purpose:
      "Research, comparisons, evidence summaries, and market intelligence.",
    example:
      "@VarVik Research compare these options and separate facts from assumptions.",
  },
  "VarVik Command": {
    purpose:
      "Varun's private coordinator across Buzz, Watchdog, Sylars, and GitHub.",
    example:
      "@VarVik Command coordinate an investigation and give me one clear plan.",
  },
  "Watchdog Sentinel": {
    purpose:
      "Varun's private incident, reliability, alert, and regression investigator.",
    example:
      "@Watchdog Sentinel investigate this alert without changing production.",
  },
  "Sylars Coordinator": {
    purpose:
      "Varun's private coordinator for assignments, priorities, and blockers.",
    example:
      "@Sylars Coordinator summarize overdue work and the main blockers.",
  },
  "VarVik Forge": {
    purpose:
      "Varun's private GitHub issue, code-fix, testing, and pull-request specialist.",
    example:
      "@VarVik Forge diagnose issue 123 and prepare a draft pull request.",
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
              <strong>2.</strong> Use the + beside an agent to add it to that
              channel.
            </li>
            <li>
              <strong>3.</strong> Start your message with its exact name,
              including the @ sign—for example:{" "}
              <Code>@VarVik Engineer review this error</Code>.
            </li>
            <li>
              <strong>4.</strong> Include the outcome, context, constraints, and
              deadline.
            </li>
          </ol>
          <div className="mt-4 rounded-xl bg-[#d7d72e]/15 p-4 text-sm leading-6 text-black/65 dark:text-white/60">
            <strong>Good request:</strong> “@VarVik Research compare these three
            vendors, use sources from this year, and give me a short
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
            Use your private <Code>brief-yourname</Code> channel for assigned
            work, reminders, mentions, and your morning summary. The Companion
            must not post that personal information into general or project
            channels.
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

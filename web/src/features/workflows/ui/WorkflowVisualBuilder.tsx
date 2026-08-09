import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  Code2,
  GripVertical,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import { stringify } from "yaml";
import type { WorkspaceProfile } from "@/features/workspace/workspace-api";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowTrigger,
} from "../workflow-policy";
import { parseWorkflowDefinition } from "../workflow-policy";

type BuilderNodeKind =
  | "agent_task"
  | "web_search"
  | "library_tool"
  | "send_message"
  | "request_approval"
  | "call_webhook"
  | "delay";

type BuilderStep = {
  id: string;
  kind: BuilderNodeKind;
  name: string;
  condition: string;
  agent: string;
  prompt: string;
  tool: string;
  url: string;
  duration: string;
  approver: string;
};

export type WorkflowBuilderState = {
  name: string;
  description: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  steps: BuilderStep[];
};

const NODE_LIBRARY: Array<{
  kind: BuilderNodeKind;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    kind: "agent_task",
    label: "Ask an agent",
    description: "Give a hosted agent a clear task",
    icon: Bot,
  },
  {
    kind: "web_search",
    label: "Search the web",
    description: "Ask an agent to research current sources",
    icon: Search,
  },
  {
    kind: "library_tool",
    label: "Use a library tool",
    description: "Ask an agent to use a named tool or skill",
    icon: Wrench,
  },
  {
    kind: "send_message",
    label: "Send a message",
    description: "Post a result in this channel",
    icon: Send,
  },
  {
    kind: "request_approval",
    label: "Request approval",
    description: "Pause until a person approves",
    icon: CheckCircle2,
  },
  {
    kind: "call_webhook",
    label: "Call a webhook",
    description: "Send data to an approved HTTPS endpoint",
    icon: Webhook,
  },
  {
    kind: "delay",
    label: "Wait",
    description: "Delay the next step for up to 4m 30s",
    icon: Clock3,
  },
];

const TRIGGERS: Array<{ value: WorkflowTrigger["on"]; label: string }> = [
  { value: "message_posted", label: "A message is posted" },
  { value: "reaction_added", label: "A reaction is added" },
  { value: "diff_posted", label: "A code diff is posted" },
  { value: "member_joined", label: "A member joins" },
  { value: "schedule", label: "On a schedule" },
  { value: "webhook", label: "A webhook arrives" },
];

function nextId(kind: BuilderNodeKind, steps: readonly BuilderStep[]): string {
  const base = kind.replace(/[^a-z0-9_]/g, "_");
  let index = 1;
  while (steps.some((step) => step.id === `${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function createStep(
  kind: BuilderNodeKind,
  steps: readonly BuilderStep[],
  agents: readonly WorkspaceProfile[],
): BuilderStep {
  const definition = NODE_LIBRARY.find((node) => node.kind === kind);
  return {
    id: nextId(kind, steps),
    kind,
    name: definition?.label ?? "Workflow step",
    condition: "",
    agent: agents[0]?.name ?? "",
    prompt: kind === "send_message" ? "Workflow received a message" : "",
    tool: "",
    url: "https://",
    duration: "1m",
    approver: "@owner",
  };
}

function agentMessage(step: BuilderStep): string {
  const mention = step.agent.trim() ? `@${step.agent.trim()} ` : "";
  if (step.kind === "web_search") {
    return `${mention}Search the web using current, source-linked information. ${step.prompt.trim()}`.trim();
  }
  if (step.kind === "library_tool") {
    return `${mention}Use the ${step.tool.trim() || "selected"} tool or skill from your library. ${step.prompt.trim()}`.trim();
  }
  return `${mention}${step.prompt.trim()}`.trim();
}

function toWorkflowStep(step: BuilderStep): WorkflowStep {
  const shared = {
    id: step.id,
    ...(step.name.trim() ? { name: step.name.trim() } : {}),
    ...(step.condition.trim() ? { if: step.condition.trim() } : {}),
  };
  switch (step.kind) {
    case "agent_task":
    case "web_search":
    case "library_tool":
      return {
        ...shared,
        action: "send_message",
        text: agentMessage(step),
      };
    case "send_message":
      return { ...shared, action: "send_message", text: step.prompt.trim() };
    case "request_approval":
      return {
        ...shared,
        action: "request_approval",
        from: step.approver.trim(),
        message: step.prompt.trim(),
      };
    case "call_webhook":
      return {
        ...shared,
        action: "call_webhook",
        url: step.url.trim(),
        method: "POST",
        ...(step.prompt.trim() ? { body: step.prompt.trim() } : {}),
      };
    case "delay":
      return { ...shared, action: "delay", duration: step.duration.trim() };
  }
}

export function buildWorkflowYaml(state: WorkflowBuilderState): string {
  const definition: WorkflowDefinition = {
    name: state.name.trim(),
    ...(state.description.trim()
      ? { description: state.description.trim() }
      : {}),
    trigger: state.trigger,
    steps: state.steps.map(toWorkflowStep),
    enabled: state.enabled,
  };
  const yaml = stringify(definition, { lineWidth: 0 });
  parseWorkflowDefinition(yaml);
  return yaml;
}

function defaultState(
  agents: readonly WorkspaceProfile[],
): WorkflowBuilderState {
  return {
    name: "New workflow",
    description: "",
    enabled: true,
    trigger: { on: "message_posted" },
    steps: [createStep("send_message", [], agents)],
  };
}

function builderStateFromYaml(
  yaml: string,
  agents: readonly WorkspaceProfile[],
): WorkflowBuilderState {
  const definition = parseWorkflowDefinition(yaml);
  const fallbackAgent = agents[0]?.name ?? "";
  return {
    name: definition.name,
    description: definition.description ?? "",
    enabled: definition.enabled,
    trigger: definition.trigger,
    steps: definition.steps.map((step) => {
      const shared = {
        id: step.id,
        name: step.name ?? "Workflow step",
        condition: step.if ?? "",
        agent: fallbackAgent,
        prompt: "",
        tool: "",
        url: "https://",
        duration: "1m",
        approver: "@owner",
      };
      switch (step.action) {
        case "send_message":
          return {
            ...shared,
            kind: "send_message" as const,
            prompt: step.text,
          };
        case "request_approval":
          return {
            ...shared,
            kind: "request_approval" as const,
            prompt: step.message,
            approver: step.from,
          };
        case "call_webhook":
          return {
            ...shared,
            kind: "call_webhook" as const,
            prompt: step.body ?? "",
            url: step.url,
          };
        case "delay":
          return { ...shared, kind: "delay" as const, duration: step.duration };
        default:
          throw new Error(
            `The ${step.action} action is available in YAML but not in the visual builder yet.`,
          );
      }
    }),
  };
}

function triggerFromValue(value: WorkflowTrigger["on"]): WorkflowTrigger {
  switch (value) {
    case "message_posted":
    case "diff_posted":
      return { on: value };
    case "reaction_added":
      return { on: value };
    case "member_joined":
      return { on: value, include_bots: false };
    case "schedule":
      return { on: value, interval: "1h" };
    case "webhook":
      return { on: value };
  }
}

export function WorkflowVisualBuilder({
  agents,
  channelId,
  pending,
  error,
  yaml,
  onYamlChange,
  onSave,
}: {
  agents: WorkspaceProfile[];
  channelId: string;
  pending: boolean;
  error: unknown;
  yaml: string;
  onYamlChange: (value: string) => void;
  onSave: () => void;
}) {
  const [state, setState] = React.useState<WorkflowBuilderState>(() => {
    try {
      return yaml.trim()
        ? builderStateFromYaml(yaml, agents)
        : defaultState(agents);
    } catch {
      return defaultState(agents);
    }
  });
  const [selectedId, setSelectedId] = React.useState(state.steps[0]?.id ?? "");
  const [advanced, setAdvanced] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const [draggedKind, setDraggedKind] = React.useState<BuilderNodeKind | null>(
    null,
  );
  const selected = state.steps.find((step) => step.id === selectedId) ?? null;

  const commit = React.useCallback(
    (next: WorkflowBuilderState) => {
      setState(next);
      try {
        onYamlChange(buildWorkflowYaml(next));
        setValidationError(null);
      } catch (nextError) {
        setValidationError(
          nextError instanceof Error
            ? nextError.message
            : "Complete the highlighted workflow fields.",
        );
      }
    },
    [onYamlChange],
  );

  React.useEffect(() => {
    if (yaml.trim()) return;
    commit(defaultState(agents));
  }, [agents, commit, yaml]);

  const addNode = (kind: BuilderNodeKind) => {
    const node = createStep(kind, state.steps, agents);
    commit({ ...state, steps: [...state.steps, node] });
    setSelectedId(node.id);
  };
  const updateSelected = (patch: Partial<BuilderStep>) => {
    if (!selected) return;
    commit({
      ...state,
      steps: state.steps.map((step) =>
        step.id === selected.id ? { ...step, ...patch } : step,
      ),
    });
  };
  const moveSelected = (direction: -1 | 1) => {
    if (!selected) return;
    const from = state.steps.findIndex((step) => step.id === selected.id);
    const to = from + direction;
    if (to < 0 || to >= state.steps.length) return;
    const steps = [...state.steps];
    const [moving] = steps.splice(from, 1);
    if (!moving) return;
    steps.splice(to, 0, moving);
    commit({ ...state, steps });
  };

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-semibold">Workflow builder</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect a trigger to agent tasks and actions. Buzz compiles the flow
            to signed, relay-validated YAML when you save.
          </p>
        </div>
        <Button
          size="sm"
          type="button"
          variant="outline"
          onClick={() => {
            if (advanced) {
              try {
                const next = builderStateFromYaml(yaml, agents);
                setState(next);
                setSelectedId(next.steps[0]?.id ?? "");
                setValidationError(null);
                setAdvanced(false);
              } catch (nextError) {
                setValidationError(
                  nextError instanceof Error
                    ? nextError.message
                    : "Fix the YAML before returning to the visual builder.",
                );
              }
              return;
            }
            setAdvanced(true);
          }}
        >
          <Code2 className="size-4" />
          {advanced ? "Visual builder" : "View YAML"}
        </Button>
      </div>

      {advanced ? (
        <div className="p-5 sm:p-6">
          <textarea
            aria-label="Workflow YAML"
            className="min-h-96 w-full rounded-xl border border-input bg-background p-4 font-mono text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            spellCheck={false}
            value={yaml}
            onChange={(event) => {
              setValidationError(null);
              onYamlChange(event.target.value);
            }}
          />
        </div>
      ) : (
        <div className="grid min-h-[38rem] lg:grid-cols-[15rem_minmax(22rem,1fr)_19rem]">
          <aside className="border-b border-border bg-muted/20 p-4 lg:border-r lg:border-b-0">
            <p className="text-sm font-semibold">Nodes</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Drag a node into the flow, or click to add it.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {NODE_LIBRARY.map((node) => {
                const Icon = node.icon;
                return (
                  <button
                    className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    draggable
                    key={node.kind}
                    type="button"
                    onClick={() => addNode(node.kind)}
                    onDragEnd={() => setDraggedKind(null)}
                    onDragStart={() => setDraggedKind(node.kind)}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">
                        {node.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {node.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section
            aria-label="Workflow steps"
            className={cn(
              "relative bg-background/35 p-5 sm:p-7",
              draggedKind && "bg-primary/5",
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedKind) addNode(draggedKind);
              setDraggedKind(null);
            }}
          >
            <div className="mx-auto max-w-xl">
              <button
                className="flex w-full items-center gap-3 rounded-2xl border border-primary/35 bg-primary/8 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
                onClick={() => setSelectedId("trigger")}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Zap className="size-5" />
                </span>
                <span>
                  <span className="block text-xs font-medium text-primary">
                    Starts when
                  </span>
                  <span className="block font-semibold">
                    {TRIGGERS.find((item) => item.value === state.trigger.on)
                      ?.label ?? state.trigger.on}
                  </span>
                </span>
              </button>
              <div className="mx-auto h-7 w-px bg-border" />
              <div className="space-y-0">
                {state.steps.map((step, index) => {
                  const node = NODE_LIBRARY.find(
                    (candidate) => candidate.kind === step.kind,
                  );
                  const Icon = node?.icon ?? Braces;
                  return (
                    <React.Fragment key={step.id}>
                      <button
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedId === step.id
                            ? "border-primary/55"
                            : "border-border hover:border-primary/30",
                        )}
                        type="button"
                        onClick={() => setSelectedId(step.id)}
                      >
                        <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                          <Icon className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {step.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {step.kind === "web_search"
                              ? `Research with ${step.agent || "an agent"}`
                              : step.kind === "library_tool"
                                ? `${step.tool || "Choose a tool"} · ${step.agent || "Choose an agent"}`
                                : step.kind === "agent_task"
                                  ? step.agent || "Choose an agent"
                                  : node?.description}
                          </span>
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                      </button>
                      {index < state.steps.length - 1 ? (
                        <div className="mx-auto h-7 w-px bg-border" />
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </div>
              <button
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-4 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
                type="button"
                onClick={() => addNode("agent_task")}
              >
                <Plus className="size-4" /> Add the next step
              </button>
            </div>
          </section>

          <aside className="border-t border-border p-4 lg:border-t-0 lg:border-l">
            <p className="text-sm font-semibold">Configure</p>
            {selectedId === "trigger" ? (
              <div className="mt-4 space-y-4">
                <Field label="Trigger">
                  <select
                    aria-label="Trigger"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={state.trigger.on}
                    onChange={(event) =>
                      commit({
                        ...state,
                        trigger: triggerFromValue(
                          event.target.value as WorkflowTrigger["on"],
                        ),
                      })
                    }
                  >
                    {TRIGGERS.map((trigger) => (
                      <option key={trigger.value} value={trigger.value}>
                        {trigger.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {state.trigger.on === "schedule" ? (
                  <Field label="Repeat every">
                    <Input
                      value={state.trigger.interval ?? ""}
                      onChange={(event) =>
                        commit({
                          ...state,
                          trigger: {
                            on: "schedule",
                            interval: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                ) : null}
              </div>
            ) : selected ? (
              <div className="mt-4 space-y-4">
                <Field label="Step name">
                  <Input
                    value={selected.name}
                    onChange={(event) =>
                      updateSelected({ name: event.target.value })
                    }
                  />
                </Field>
                {["agent_task", "web_search", "library_tool"].includes(
                  selected.kind,
                ) ? (
                  <Field label="Agent">
                    <select
                      aria-label="Agent"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={selected.agent}
                      onChange={(event) =>
                        updateSelected({ agent: event.target.value })
                      }
                    >
                      <option value="">Choose an agent</option>
                      {agents.map((agent) => (
                        <option key={agent.pubkey} value={agent.name}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {selected.kind === "library_tool" ? (
                  <Field label="Tool or skill name">
                    <Input
                      placeholder="e.g. company knowledge, GitHub, browser"
                      value={selected.tool}
                      onChange={(event) =>
                        updateSelected({ tool: event.target.value })
                      }
                    />
                  </Field>
                ) : null}
                {selected.kind === "call_webhook" ? (
                  <Field label="HTTPS endpoint">
                    <Input
                      value={selected.url}
                      onChange={(event) =>
                        updateSelected({ url: event.target.value })
                      }
                    />
                  </Field>
                ) : null}
                {selected.kind === "delay" ? (
                  <Field label="Duration">
                    <Input
                      placeholder="1m"
                      value={selected.duration}
                      onChange={(event) =>
                        updateSelected({ duration: event.target.value })
                      }
                    />
                  </Field>
                ) : null}
                {selected.kind === "request_approval" ? (
                  <Field label="Approver">
                    <Input
                      placeholder="@owner"
                      value={selected.approver}
                      onChange={(event) =>
                        updateSelected({ approver: event.target.value })
                      }
                    />
                  </Field>
                ) : null}
                {selected.kind !== "delay" ? (
                  <Field
                    label={
                      selected.kind === "call_webhook"
                        ? "Request body"
                        : selected.kind === "send_message"
                          ? "Message"
                          : "Instructions"
                    }
                  >
                    <textarea
                      aria-label={
                        selected.kind === "call_webhook"
                          ? "Request body"
                          : selected.kind === "send_message"
                            ? "Message"
                            : "Instructions"
                      }
                      className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm"
                      placeholder="Describe the exact outcome you need"
                      value={selected.prompt}
                      onChange={(event) =>
                        updateSelected({ prompt: event.target.value })
                      }
                    />
                  </Field>
                ) : null}
                <Field label="Run only if (advanced)">
                  <Input
                    placeholder="Optional condition"
                    value={selected.condition}
                    onChange={(event) =>
                      updateSelected({ condition: event.target.value })
                    }
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    aria-label="Move step up"
                    size="icon"
                    type="button"
                    variant="outline"
                    onClick={() => moveSelected(-1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    aria-label="Move step down"
                    size="icon"
                    type="button"
                    variant="outline"
                    onClick={() => moveSelected(1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    className="ml-auto"
                    size="icon"
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      const steps = state.steps.filter(
                        (step) => step.id !== selected.id,
                      );
                      if (!steps.length) return;
                      commit({ ...state, steps });
                      setSelectedId(steps[0]?.id ?? "trigger");
                    }}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Delete step</span>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Select a trigger or step to configure it.
              </p>
            )}
          </aside>
        </div>
      )}

      <div className="border-t border-border px-5 py-4 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Workflow name">
            <Input
              value={state.name}
              onChange={(event) =>
                commit({ ...state, name: event.target.value })
              }
            />
          </Field>
          <Field label="Description">
            <Input
              placeholder="What this automation accomplishes"
              value={state.description}
              onChange={(event) =>
                commit({ ...state, description: event.target.value })
              }
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            data-testid="workflow-create"
            disabled={pending || !channelId}
            type="button"
            onClick={() => {
              try {
                parseWorkflowDefinition(yaml);
                setValidationError(null);
                onSave();
              } catch (nextError) {
                setValidationError(
                  nextError instanceof Error
                    ? nextError.message
                    : "Complete the workflow before saving.",
                );
              }
            }}
          >
            <Sparkles className="size-4" />
            {pending ? "Saving…" : "Save workflow"}
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              checked={state.enabled}
              type="checkbox"
              onChange={(event) =>
                commit({ ...state, enabled: event.target.checked })
              }
            />
            Start automatically when the trigger happens
          </label>
        </div>
        {validationError ? <InlineError error={validationError} /> : null}
        {error ? <InlineError error={error} /> : null}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block text-sm font-medium">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </div>
  );
}

function InlineError({ error }: { error: unknown }) {
  return (
    <p className="mt-4 text-sm text-destructive" role="alert">
      {error instanceof Error
        ? error.message
        : "The relay rejected this change."}
    </p>
  );
}

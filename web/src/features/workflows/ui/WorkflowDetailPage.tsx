import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  CirclePlay,
  FilePenLine,
  Power,
  PowerOff,
  Trash2,
  Workflow,
} from "lucide-react";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import { Button } from "@/shared/ui/button";
import {
  deleteWorkflow,
  getWorkflow,
  listWorkflowTrace,
  publishWorkflowDefinition,
  subscribeToWorkflow,
  subscribeToWorkflowTrace,
  triggerWorkflow,
} from "../workflow-api";
import {
  isWorkflowUuid,
  parseWorkflowDefinition,
  setWorkflowDefinitionEnabled,
  workflowTriggerLabel,
} from "../workflow-policy";

const workflowDetailKey = (workflowId: string) =>
  ["workflow-detail", workflowId] as const;
const workflowTraceKey = (workflowId: string) =>
  ["workflow-trace", workflowId] as const;

export function WorkflowDetailPage({ workflowId }: { workflowId: string }) {
  if (!isWorkflowUuid(workflowId)) return <InvalidWorkflowPage />;
  return (
    <WorkspaceIdentityGate>
      {(identity) => (
        <WorkflowDetailContent
          viewerPubkey={identity.pubkey.toLowerCase()}
          workflowId={workflowId.toLowerCase()}
        />
      )}
    </WorkspaceIdentityGate>
  );
}

function WorkflowDetailContent({
  workflowId,
  viewerPubkey,
}: {
  workflowId: string;
  viewerPubkey: string;
}) {
  const queryClient = useQueryClient();
  const workflowQuery = useQuery({
    queryKey: workflowDetailKey(workflowId),
    queryFn: () => getWorkflow(workflowId),
    staleTime: 15_000,
  });
  const traceQuery = useQuery({
    queryKey: workflowTraceKey(workflowId),
    queryFn: () => listWorkflowTrace(workflowId),
    staleTime: 15_000,
  });
  const [editing, setEditing] = React.useState(false);
  const [yaml, setYaml] = React.useState("");
  const [inputs, setInputs] = React.useState("{}");
  const [notice, setNotice] = React.useState<string | null>(null);
  const workflow = workflowQuery.data;
  const canManage = workflow?.ownerPubkey === viewerPubkey;

  React.useEffect(() => {
    if (!workflow || editing) return;
    setYaml(workflow.yaml);
  }, [editing, workflow]);
  React.useEffect(
    () =>
      subscribeToWorkflow(workflowId, () => {
        void queryClient.invalidateQueries({
          queryKey: workflowDetailKey(workflowId),
        });
      }),
    [queryClient, workflowId],
  );
  React.useEffect(
    () =>
      subscribeToWorkflowTrace(workflowId, () => {
        void queryClient.invalidateQueries({
          queryKey: workflowTraceKey(workflowId),
        });
      }),
    [queryClient, workflowId],
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!workflow) throw new Error("Workflow is unavailable.");
      parseWorkflowDefinition(yaml);
      return publishWorkflowDefinition({
        workflowId: workflow.id,
        channelId: workflow.channelId,
        yaml,
      });
    },
    onSuccess: () => {
      setEditing(false);
      setNotice("Workflow definition saved.");
      void queryClient.invalidateQueries({
        queryKey: workflowDetailKey(workflowId),
      });
    },
  });
  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!workflow) throw new Error("Workflow is unavailable.");
      return publishWorkflowDefinition({
        workflowId: workflow.id,
        channelId: workflow.channelId,
        yaml: setWorkflowDefinitionEnabled(workflow.yaml, enabled),
      });
    },
    onSuccess: (_receipt, enabled) => {
      setNotice(
        enabled
          ? "Automatic workflow dispatch is enabled."
          : "Automatic workflow dispatch is disabled in this definition.",
      );
      void queryClient.invalidateQueries({
        queryKey: workflowDetailKey(workflowId),
      });
    },
  });
  const triggerMutation = useMutation({
    mutationFn: () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(inputs || "{}");
      } catch {
        throw new Error("Run inputs must be valid JSON.");
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("Run inputs must be a JSON object.");
      }
      return triggerWorkflow({
        workflowId,
        inputs: parsed as Record<string, unknown>,
      });
    },
    onSuccess: (receipt) => {
      setNotice(
        receipt.runId
          ? `Run ${receipt.runId} was accepted by the relay.`
          : "Run command was accepted by the relay.",
      );
      void queryClient.invalidateQueries({
        queryKey: workflowTraceKey(workflowId),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!workflow) throw new Error("Workflow is unavailable.");
      return deleteWorkflow({
        workflowId: workflow.id,
        ownerPubkey: workflow.ownerPubkey,
      });
    },
    onSuccess: () => {
      window.location.assign("/workflows");
    },
  });

  if (workflowQuery.isLoading) return <LoadingPage />;
  if (workflowQuery.isError)
    return <WorkflowError error={workflowQuery.error} />;
  if (!workflow) return <MissingWorkflowPage />;

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-8 flex flex-wrap items-center gap-4 text-sm">
          <a className="text-muted-foreground hover:text-foreground" href="/">
            Workspace
          </a>
          <a
            className="text-muted-foreground hover:text-foreground"
            href={`/workflows?channel=${encodeURIComponent(workflow.channelId)}`}
          >
            Workflows
          </a>
          <span className="truncate text-foreground">
            {workflow.definition.name}
          </span>
        </nav>

        <header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Workflow className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight">
                    {workflow.definition.name}
                  </h1>
                  <EnabledBadge enabled={workflow.definition.enabled} />
                </div>
                {workflow.definition.description ? (
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {workflow.definition.description}
                  </p>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  {workflowTriggerLabel(workflow.definition.trigger)} · #
                  {workflow.channelId} · {workflow.definition.steps.length} step
                  {workflow.definition.steps.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={toggleMutation.isPending}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() =>
                    toggleMutation.mutate(!workflow.definition.enabled)
                  }
                >
                  {workflow.definition.enabled ? (
                    <PowerOff className="size-4" />
                  ) : (
                    <Power className="size-4" />
                  )}
                  {workflow.definition.enabled
                    ? "Stop automatic dispatch"
                    : "Enable automatic dispatch"}
                </Button>
                <Button
                  disabled={deleteMutation.isPending}
                  size="sm"
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this workflow? Existing server run history is retained according to relay policy.",
                      )
                    ) {
                      deleteMutation.mutate();
                    }
                  }}
                >
                  <Trash2 className="size-4" /> Delete
                </Button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Definition</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  YAML is parsed strictly in the browser and authoritatively by
                  the relay when saved.
                </p>
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => setEditing((current) => !current)}
                >
                  <FilePenLine className="size-4" />
                  {editing ? "Cancel edit" : "Edit"}
                </Button>
              ) : null}
            </div>
            {editing && canManage ? (
              <>
                <textarea
                  aria-label="Workflow YAML"
                  className="mt-5 min-h-96 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs leading-5 shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  spellCheck={false}
                  value={yaml}
                  onChange={(event) => setYaml(event.target.value)}
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    data-testid="workflow-save"
                    disabled={saveMutation.isPending}
                    type="button"
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save replacement"}
                  </Button>
                  <Button
                    disabled={saveMutation.isPending}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setYaml(workflow.yaml);
                      setEditing(false);
                    }}
                  >
                    Discard
                  </Button>
                </div>
              </>
            ) : (
              <pre className="mt-5 max-h-[38rem] overflow-auto rounded-lg bg-muted/45 p-4 text-xs leading-5">
                {workflow.yaml}
              </pre>
            )}
            {saveMutation.error ? (
              <InlineError error={saveMutation.error} />
            ) : null}
            {toggleMutation.error ? (
              <InlineError error={toggleMutation.error} />
            ) : null}
            {deleteMutation.error ? (
              <InlineError error={deleteMutation.error} />
            ) : null}
          </section>

          <RunWorkflowCard
            canManage={Boolean(canManage)}
            error={triggerMutation.error}
            inputs={inputs}
            pending={triggerMutation.isPending}
            enabled={workflow.definition.enabled}
            onInputsChange={setInputs}
            onTrigger={() => triggerMutation.mutate()}
          />
        </div>

        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="font-semibold">Run trace</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            This view reads only relay workflow trace events (46001–46007). It
            does not query the desktop-only workflow database projection.
          </p>
          {traceQuery.isLoading ? (
            <p className="mt-5 text-sm text-muted-foreground">Loading trace…</p>
          ) : traceQuery.isError ? (
            <InlineError error={traceQuery.error} />
          ) : traceQuery.data?.length ? (
            <ol className="mt-5 space-y-3">
              {traceQuery.data.map((event) => (
                <li
                  className="rounded-xl border border-border p-4"
                  key={event.id}
                >
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>kind {event.kind}</span>
                    <span>
                      {new Date(event.createdAt * 1000).toLocaleString()}
                    </span>
                  </div>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5">
                    {event.content || "(no trace content)"}
                  </pre>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-border px-4 py-5 text-sm leading-6 text-muted-foreground">
              The current relay stores run history in its workflow database but
              does not emit 46001–46007 events yet, so no browser-readable trace
              is available.
            </p>
          )}
        </section>

        {notice ? (
          <p className="mt-6 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}
      </div>
    </main>
  );
}

function RunWorkflowCard({
  canManage,
  enabled,
  inputs,
  pending,
  error,
  onInputsChange,
  onTrigger,
}: {
  canManage: boolean;
  enabled: boolean;
  inputs: string;
  pending: boolean;
  error: unknown;
  onInputsChange: (value: string) => void;
  onTrigger: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <CirclePlay className="size-4 text-primary" />
        <h2 className="font-semibold">Manual run</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Sends a signed kind 46020 command. The relay only allows the workflow
        owner to run it and returns the run identifier in its acknowledgement.
      </p>
      {!enabled ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-950 dark:text-amber-100">
          Automatic matching is disabled in this definition. The current relay
          still permits a manual command when its separate server lifecycle flag
          is active.
        </p>
      ) : null}
      <label className="mt-5 block text-sm font-medium">
        <span>JSON inputs</span>
        <textarea
          aria-label="Workflow run inputs"
          className="mt-2 min-h-32 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs leading-5 shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          spellCheck={false}
          value={inputs}
          onChange={(event) => onInputsChange(event.target.value)}
        />
      </label>
      {canManage ? (
        <Button
          className="mt-4"
          data-testid="workflow-run"
          disabled={pending}
          type="button"
          onClick={onTrigger}
        >
          <CirclePlay className="size-4" />
          {pending ? "Starting…" : "Run workflow"}
        </Button>
      ) : (
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Only the workflow owner can send a manual run command.
        </p>
      )}
      {error ? <InlineError error={error} /> : null}
    </section>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        enabled
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {enabled ? "Automatic" : "Automatic dispatch off"}
    </span>
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

function LoadingPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background text-muted-foreground">
      Loading workflow…
    </main>
  );
}

function InvalidWorkflowPage() {
  return (
    <WorkflowMessage
      title="Workflow not found"
      message="A workflow URL needs a UUID."
    />
  );
}

function MissingWorkflowPage() {
  return (
    <WorkflowMessage
      title="Workflow not found"
      message="The relay did not return a valid current definition."
    />
  );
}

function WorkflowError({ error }: { error: unknown }) {
  return (
    <WorkflowMessage
      title="Workflow unavailable"
      message={
        error instanceof Error ? error.message : "The relay request failed."
      }
    />
  );
}

function WorkflowMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-foreground">
      <section className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {message}
        </p>
        <a
          className="mt-5 inline-flex text-sm text-primary hover:underline"
          href="/workflows"
        >
          Return to workflows
        </a>
      </section>
    </main>
  );
}

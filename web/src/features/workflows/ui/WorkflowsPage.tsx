import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  Check,
  CirclePlay,
  ClipboardCheck,
  Plus,
  Workflow,
} from "lucide-react";
import { WorkspaceIdentityGate } from "@/features/access/WorkspaceIdentityGate";
import {
  listWorkspaceChannels,
  type WorkspaceChannel,
} from "@/features/workspace/workspace-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  actOnWorkflowApproval,
  listChannelWorkflows,
  listWorkflowApprovalRequests,
  publishWorkflowDefinition,
  subscribeToChannelWorkflows,
  subscribeToWorkflowApprovalRequests,
  type WorkflowApprovalRequest,
} from "../workflow-api";
import { parseWorkflowDefinition } from "../workflow-policy";

const channelWorkflowsKey = (channelId: string) =>
  ["workflow-channel", channelId] as const;
const workflowApprovalsKey = (pubkey: string) =>
  ["workflow-approvals", pubkey] as const;

function starterYaml() {
  return `name: New workflow
description: Describe what this automation does
trigger:
  on: message_posted
steps:
  - id: notify
    action: send_message
    text: "Workflow received a message"
enabled: true
`;
}

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (elapsed < 60) return "now";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)}h`;
  return `${Math.floor(elapsed / 86_400)}d`;
}

export function WorkflowsPage() {
  return (
    <WorkspaceIdentityGate>
      {(identity) => <WorkflowsPageContent viewerPubkey={identity.pubkey} />}
    </WorkspaceIdentityGate>
  );
}

function WorkflowsPageContent({ viewerPubkey }: { viewerPubkey: string }) {
  const queryClient = useQueryClient();
  const channelsQuery = useQuery({
    queryKey: ["workspace-channels", viewerPubkey],
    queryFn: () => listWorkspaceChannels(viewerPubkey),
    staleTime: 60_000,
  });
  const workflowChannels = (channelsQuery.data ?? []).filter(
    (channel) => channel.type !== "dm",
  );
  const initialChannel = new URLSearchParams(window.location.search).get(
    "channel",
  );
  const [channelId, setChannelId] = React.useState(initialChannel ?? "");
  const [yaml, setYaml] = React.useState(starterYaml);
  const [webhookSecret, setWebhookSecret] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (
      channelId &&
      workflowChannels.some((channel) => channel.id === channelId)
    ) {
      return;
    }
    setChannelId(workflowChannels[0]?.id ?? "");
  }, [channelId, workflowChannels]);

  const workflowsQuery = useQuery({
    queryKey: channelWorkflowsKey(channelId),
    queryFn: () => listChannelWorkflows(channelId),
    enabled: Boolean(channelId),
    staleTime: 15_000,
  });
  const approvalsQuery = useQuery({
    queryKey: workflowApprovalsKey(viewerPubkey),
    queryFn: () => listWorkflowApprovalRequests(viewerPubkey),
    staleTime: 15_000,
  });

  React.useEffect(() => {
    if (!channelId) return;
    return subscribeToChannelWorkflows(channelId, () => {
      void queryClient.invalidateQueries({
        queryKey: channelWorkflowsKey(channelId),
      });
    });
  }, [channelId, queryClient]);
  React.useEffect(
    () =>
      subscribeToWorkflowApprovalRequests(viewerPubkey, () => {
        void queryClient.invalidateQueries({
          queryKey: workflowApprovalsKey(viewerPubkey),
        });
      }),
    [queryClient, viewerPubkey],
  );

  const createMutation = useMutation({
    mutationFn: () => publishWorkflowDefinition({ channelId, yaml }),
    onSuccess: (receipt) => {
      setWebhookSecret(receipt.webhookSecret ?? null);
      setNotice(
        receipt.workflowId
          ? `Workflow ${receipt.workflowId} saved.`
          : "Workflow saved.",
      );
      void queryClient.invalidateQueries({
        queryKey: channelWorkflowsKey(channelId),
      });
    },
  });

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 flex flex-wrap items-center gap-4 text-sm">
          <a className="text-muted-foreground hover:text-foreground" href="/">
            Workspace
          </a>
          <span className="text-foreground">Workflows</span>
        </nav>

        <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Workflow className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Workflows
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Channel automations are signed kind 30620 definitions. The relay
                validates and executes them; the browser never runs a workflow
                locally.
              </p>
            </div>
          </div>
          <a
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            href="/search"
          >
            Search activity
          </a>
        </header>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Channel definitions</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Current replacement heads update live when a teammate edits a
                  workflow.
                </p>
              </div>
              <ChannelPicker
                channels={workflowChannels}
                value={channelId}
                onChange={setChannelId}
              />
            </div>
            {workflowsQuery.isLoading ? (
              <p className="mt-6 text-sm text-muted-foreground">
                Loading workflows…
              </p>
            ) : workflowsQuery.isError ? (
              <InlineError error={workflowsQuery.error} />
            ) : !channelId ? (
              <p className="mt-6 text-sm text-muted-foreground">
                Join a channel before creating a workflow.
              </p>
            ) : workflowsQuery.data?.length ? (
              <div className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {workflowsQuery.data.map((workflow) => (
                  <a
                    className="block px-4 py-4 transition-colors hover:bg-muted/35"
                    href={`/workflows/${workflow.id}`}
                    key={`${workflow.ownerPubkey}:${workflow.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {workflow.definition.name}
                      </span>
                      <EnabledBadge enabled={workflow.definition.enabled} />
                      <span className="ml-auto text-xs text-muted-foreground">
                        {relativeTime(workflow.createdAt)}
                      </span>
                    </div>
                    {workflow.definition.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {workflow.definition.description}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {workflow.definition.trigger.on.replace(/_/g, " ")} ·{" "}
                      {workflow.definition.steps.length} step
                      {workflow.definition.steps.length === 1 ? "" : "s"}
                    </p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">
                No workflow definitions in this channel yet.
              </p>
            )}
          </section>

          <CreateWorkflowCard
            channelId={channelId}
            error={createMutation.error}
            pending={createMutation.isPending}
            yaml={yaml}
            onSave={() => createMutation.mutate()}
            onYamlChange={setYaml}
          />
        </div>

        <ApprovalRequests
          error={approvalsQuery.error}
          pending={approvalsQuery.isLoading}
          requests={approvalsQuery.data ?? []}
          viewerPubkey={viewerPubkey}
        />

        {notice ? (
          <p className="mt-6 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}
        {webhookSecret ? (
          <section
            className="mt-6 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4"
            data-testid="workflow-webhook-secret"
          >
            <p className="font-medium">Copy this webhook secret now</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The relay only returns it when this webhook workflow is first
              saved. It is never stored by the browser.
            </p>
            <code className="mt-3 block break-all rounded-lg bg-background/70 p-3 text-sm">
              {webhookSecret}
            </code>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ChannelPicker({
  channels,
  value,
  onChange,
}: {
  channels: WorkspaceChannel[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm font-medium">
      <span className="sr-only">Workflow channel</span>
      <select
        aria-label="Workflow channel"
        className="h-9 max-w-56 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {channels.length ? null : <option value="">No joined channels</option>}
        {channels.map((channel) => (
          <option key={channel.id} value={channel.id}>
            #{channel.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CreateWorkflowCard({
  channelId,
  yaml,
  pending,
  error,
  onYamlChange,
  onSave,
}: {
  channelId: string;
  yaml: string;
  pending: boolean;
  error: unknown;
  onYamlChange: (value: string) => void;
  onSave: () => void;
}) {
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-primary" />
        <h2 className="font-semibold">New workflow</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        The editor validates the shared YAML schema before signing. The relay
        remains the authority for membership, webhook safety, and execution.
      </p>
      <textarea
        aria-label="Workflow YAML"
        className="mt-5 min-h-80 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs leading-5 shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        spellCheck={false}
        value={yaml}
        onChange={(event) => {
          setValidationError(null);
          onYamlChange(event.target.value);
        }}
      />
      <Button
        className="mt-4"
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
                : "Workflow YAML is invalid.",
            );
          }
        }}
      >
        <CirclePlay className="size-4" />
        {pending ? "Saving…" : "Save workflow"}
      </Button>
      {validationError ? <InlineError error={validationError} /> : null}
      {error ? <InlineError error={error} /> : null}
    </section>
  );
}

function ApprovalRequests({
  viewerPubkey,
  requests,
  pending,
  error,
}: {
  viewerPubkey: string;
  requests: WorkflowApprovalRequest[];
  pending: boolean;
  error: unknown;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const actionMutation = useMutation({
    mutationFn: (input: { tokenHash: string; action: "grant" | "deny" }) =>
      actOnWorkflowApproval({
        ...input,
        note: notes[input.tokenHash],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: workflowApprovalsKey(viewerPubkey),
      });
    },
  });
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-4 text-primary" />
        <div>
          <h2 className="font-semibold">Approval requests</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only kind 46010 events explicitly tagged to your public key appear
            here. The relay checks the approver and expiry again when acting.
          </p>
        </div>
      </div>
      {pending ? (
        <p className="mt-5 text-sm text-muted-foreground">Loading requests…</p>
      ) : error ? (
        <InlineError error={error} />
      ) : requests.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {requests.map((request) => (
            <article
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
              data-testid={`workflow-approval-${request.eventId}`}
              key={request.eventId}
            >
              <p className="text-sm font-medium">Approval required</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {request.content || "No approval message was supplied."}
              </p>
              <p className="mt-3 font-mono text-xs text-muted-foreground">
                {request.tokenHash.slice(0, 12)}… ·{" "}
                {relativeTime(request.createdAt)}
              </p>
              <Input
                aria-label={`Approval note for ${request.tokenHash}`}
                className="mt-3"
                placeholder="Optional note"
                value={notes[request.tokenHash] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({
                    ...current,
                    [request.tokenHash]: event.target.value,
                  }))
                }
              />
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={actionMutation.isPending}
                  size="sm"
                  type="button"
                  onClick={() =>
                    actionMutation.mutate({
                      tokenHash: request.tokenHash,
                      action: "grant",
                    })
                  }
                >
                  <Check className="size-3.5" /> Approve
                </Button>
                <Button
                  className="flex-1"
                  disabled={actionMutation.isPending}
                  size="sm"
                  type="button"
                  variant="destructive"
                  onClick={() =>
                    actionMutation.mutate({
                      tokenHash: request.tokenHash,
                      action: "deny",
                    })
                  }
                >
                  Deny
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          No relay approval requests are available. Current relay workflow
          execution does not yet emit approval-request events end-to-end.
        </p>
      )}
      {actionMutation.error ? (
        <InlineError error={actionMutation.error} />
      ) : null}
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

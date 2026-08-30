import type {
  WorkspaceAgentModelFamily,
  WorkspaceReasoningEffort,
} from "./workspace-agent-models.ts";
import type { WorkspaceAgentRuntimeProjection } from "./workspace-agent-runtime.ts";
import type { HostedAgentConfigInput } from "./workspace-hosted-agent-config-policy.ts";

export type HostedAgentUpdate = {
  name: string;
  avatarUrl: string | null;
  model: string | null;
  effort: WorkspaceReasoningEffort | null;
};

export type HostedAgentUpdateSource = {
  pubkey: string;
  name: string;
  picture?: string;
  legacyHostedConfigModel?: string | null;
  modelFamilies?: readonly WorkspaceAgentModelFamily[];
  runtime?: WorkspaceAgentRuntimeProjection;
  runtimeCatalogDigest?: string;
  runtimeControllerPubkey?: string;
  runtimeStatusTrusted?: boolean;
};

export type HostedAgentRuntimeUpdate = {
  agentPubkey: string;
  model: string;
  effort: WorkspaceReasoningEffort;
  runtimeName: string;
  catalogDigest: string;
};

export type HostedAgentUpdatePlan = {
  presentation: HostedAgentConfigInput | null;
  runtime: HostedAgentRuntimeUpdate | null;
  runtimeUsesPresentation: boolean;
};

export type HostedAgentRuntimePublishInput = HostedAgentRuntimeUpdate & {
  presentationEventId: string | null;
};

export type HostedAgentUpdateEffects = {
  publishPresentation: (
    input: HostedAgentConfigInput,
  ) => Promise<{ id: string }>;
  publishRuntime: (
    input: HostedAgentRuntimePublishInput,
  ) => Promise<{ id: string }>;
};

function normalizedOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function runtimeSelectionChanged(
  agent: HostedAgentUpdateSource,
  model: string,
  effort: WorkspaceReasoningEffort,
): boolean {
  const selected = agent.runtime?.pending ?? agent.runtime?.effective;
  return selected?.model !== model || selected.effort !== effort;
}

function validatedRuntimeUpdate(
  agent: HostedAgentUpdateSource,
  update: HostedAgentUpdate,
  runtimeName: string,
): HostedAgentRuntimeUpdate {
  if (
    !agent.runtime ||
    !agent.runtimeStatusTrusted ||
    !agent.runtimeCatalogDigest ||
    !/^[0-9a-f]{64}$/.test(agent.runtimeCatalogDigest) ||
    !agent.runtimeControllerPubkey ||
    !/^[0-9a-f]{64}$/.test(agent.runtimeControllerPubkey)
  ) {
    throw new Error(
      "This agent's runtime controller and current status cannot be verified. Refresh and try again.",
    );
  }
  if (!update.model || !update.effort) {
    throw new Error("Choose both a model and a reasoning effort.");
  }
  const family = agent.modelFamilies?.find(
    (candidate) => candidate.id === update.model,
  );
  if (!family?.efforts.includes(update.effort)) {
    throw new Error("This model and effort combination is not available.");
  }
  return {
    agentPubkey: agent.pubkey,
    model: family.id,
    effort: update.effort,
    runtimeName,
    catalogDigest: agent.runtimeCatalogDigest,
  };
}

/** Plan presentation and runtime writes before either side effect begins. */
export function planHostedAgentUpdate(
  agent: HostedAgentUpdateSource,
  update: HostedAgentUpdate,
): HostedAgentUpdatePlan {
  const name = update.name.trim();
  if (!name) throw new Error("Hosted agent name is required.");
  const avatarUrl = normalizedOptional(update.avatarUrl);
  const presentationChanged =
    name !== agent.name.trim() ||
    avatarUrl !== normalizedOptional(agent.picture);
  const nameChanged = name !== agent.name.trim();
  const wantsRuntimeChange =
    update.model !== null &&
    update.effort !== null &&
    runtimeSelectionChanged(agent, update.model, update.effort);
  const needsRuntimeReconciliation = Boolean(agent.runtime) && nameChanged;
  const runtime =
    wantsRuntimeChange || needsRuntimeReconciliation
      ? validatedRuntimeUpdate(agent, update, name)
      : null;

  return {
    presentation: presentationChanged
      ? {
          pubkey: agent.pubkey,
          name,
          avatarUrl,
          model: normalizedOptional(agent.legacyHostedConfigModel),
        }
      : null,
    runtime,
    runtimeUsesPresentation: Boolean(runtime && nameChanged),
  };
}

/** Execute a preflighted plan in the only safe cross-event order. */
export async function executeHostedAgentUpdatePlan(
  plan: HostedAgentUpdatePlan,
  effects: HostedAgentUpdateEffects,
): Promise<{
  presentationEventId: string | null;
  runtimeEventId: string | null;
}> {
  const presentationEvent = plan.presentation
    ? await effects.publishPresentation(plan.presentation)
    : null;
  const runtimeEvent = plan.runtime
    ? await effects.publishRuntime({
        ...plan.runtime,
        presentationEventId: plan.runtimeUsesPresentation
          ? (presentationEvent?.id ?? null)
          : null,
      })
    : null;
  return {
    presentationEventId: presentationEvent?.id ?? null,
    runtimeEventId: runtimeEvent?.id ?? null,
  };
}

import {
  type NostrEvent,
  publishEvent,
  queryEvents,
} from "@/shared/lib/nostr-client";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { nip44EncryptToRecipient } from "@/shared/lib/nostr-signer";
import {
  parseWorkspaceAgentModelFamilies,
  parseWorkspaceAgentModels,
  type WorkspaceAgentModel,
  type WorkspaceAgentModelFamily,
} from "./workspace-agent-models";
import {
  buildHostedAgentRuntimeRequestTemplate,
  discoverHostedAgentRuntime,
  KIND_HOSTED_AGENT_RUNTIME_STATUS,
  latestTrustedRuntimeStatus,
  parseAgentRuntimeAcknowledgement,
  projectWorkspaceAgentRuntime,
  type HostedAgentRuntimeDiscovery,
  type RuntimeRequestInput,
  type WorkspaceAgentRuntimeProjection,
} from "./workspace-agent-runtime";

export type WorkspaceAgentRuntimeContext = {
  discovery: HostedAgentRuntimeDiscovery | null;
  statusEvents: NostrEvent[];
};

export type WorkspaceAgentRuntimeFields = {
  model?: string;
  models?: WorkspaceAgentModel[];
  modelFamilies?: WorkspaceAgentModelFamily[];
  runtime?: WorkspaceAgentRuntimeProjection;
  runtimeCatalogDigest?: string;
  runtimeControllerPubkey?: string;
  runtimeStatusTrusted?: boolean;
};

/** Load controller discovery and its public runtime heads without blocking the roster. */
export async function loadWorkspaceAgentRuntimeContext(): Promise<WorkspaceAgentRuntimeContext> {
  const discovery = await discoverHostedAgentRuntime(relayHttpBaseUrl());
  let statusEvents: NostrEvent[] = [];
  if (discovery) {
    try {
      statusEvents = await queryEvents(relayWsUrl(), {
        kinds: [KIND_HOSTED_AGENT_RUNTIME_STATUS],
        authors: [discovery.controllerPubkey],
        limit: 500,
      });
    } catch {
      // Keep the roster usable, but leave runtime mutation fail-closed.
    }
  }
  return { discovery, statusEvents };
}

/** Project only agent-signed and pinned-controller runtime fields. */
export function projectWorkspaceAgentRuntimeFields(
  agentPubkey: string,
  content: Record<string, unknown>,
  context: WorkspaceAgentRuntimeContext,
): WorkspaceAgentRuntimeFields {
  const acknowledgement = context.discovery
    ? parseAgentRuntimeAcknowledgement(
        content.runtime,
        context.discovery.controllerPubkey,
      )
    : null;
  const status = context.discovery
    ? latestTrustedRuntimeStatus(
        context.statusEvents,
        agentPubkey,
        context.discovery.controllerPubkey,
      )
    : null;
  const runtime = projectWorkspaceAgentRuntime(acknowledgement, status);
  return {
    model:
      runtime?.effective.model ??
      (!context.discovery && typeof content.model === "string"
        ? content.model
        : undefined),
    models: parseWorkspaceAgentModels(content.models),
    modelFamilies: parseWorkspaceAgentModelFamilies(content.model_families),
    runtime: runtime ?? undefined,
    runtimeCatalogDigest: acknowledgement?.catalogDigest,
    runtimeControllerPubkey: context.discovery?.controllerPubkey,
    runtimeStatusTrusted: status !== null,
  };
}

/** Publish one encrypted runtime request; presentation remains a separate write. */
export async function publishHostedAgentRuntimeRequest(
  input: Omit<
    RuntimeRequestInput,
    "controllerPubkey" | "requestId" | "nowSeconds"
  >,
): Promise<NostrEvent> {
  const discovery = await discoverHostedAgentRuntime(relayHttpBaseUrl());
  if (!discovery) {
    throw new Error("The runtime controller is unavailable. Try again.");
  }
  const template = await buildHostedAgentRuntimeRequestTemplate(
    {
      ...input,
      controllerPubkey: discovery.controllerPubkey,
      requestId: crypto.randomUUID(),
      nowSeconds: Math.floor(Date.now() / 1000),
    },
    nip44EncryptToRecipient,
  );
  return publishEvent(relayWsUrl(), template);
}

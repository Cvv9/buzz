import {
  isWorkspaceReasoningEffort,
  type WorkspaceReasoningEffort,
} from "./workspace-agent-models.ts";

export const KIND_HOSTED_AGENT_RUNTIME_REQUEST = 24201;
export const KIND_HOSTED_AGENT_RUNTIME_STATUS = 30181;
const REQUEST_SCHEMA = "buzz.hosted-agent-runtime-request.v1";
const STATUS_SCHEMA = "buzz.hosted-agent-runtime-status.v1";
const ACKNOWLEDGEMENT_SCHEMA = "buzz.agent-runtime.v1";
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type HostedAgentRuntimeDiscovery = {
  version: 1;
  controllerPubkey: string;
  requestKind: 24201;
  statusKind: 30181;
};

export type WorkspaceRuntimeSelection = {
  model: string;
  effort: WorkspaceReasoningEffort;
  runtimeName: string;
};

export type AgentRuntimeAcknowledgement = {
  controllerPubkey: string;
  revision: number;
  model: string;
  effort: WorkspaceReasoningEffort;
  effectiveName: string;
  catalogDigest: string;
};

export type WorkspaceRuntimeStatusState =
  | "current"
  | "pending_busy"
  | "applying"
  | "applied"
  | "failed";

export type WorkspaceRuntimeError = {
  code: string;
  message: string;
};

export type HostedAgentRuntimeStatus = {
  eventId: string;
  createdAt: number;
  requestId: string | null;
  revision: number;
  state: WorkspaceRuntimeStatusState;
  effective: WorkspaceRuntimeSelection;
  requested: WorkspaceRuntimeSelection | null;
  catalogDigest: string;
  error: WorkspaceRuntimeError | null;
};

export type WorkspaceAgentRuntimeProjection = {
  effective: WorkspaceRuntimeSelection;
  pending: WorkspaceRuntimeSelection | null;
  revision: number;
  state: WorkspaceRuntimeStatusState;
  error: WorkspaceRuntimeError | null;
};

type RuntimeEvent = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
};

const fixedErrors: Record<string, string> = {
  unsupported_selection: "This model and effort combination is not available.",
  stale_catalog: "The agent model catalog changed. Refresh and try again.",
  controller_unavailable: "The runtime controller is unavailable. Try again.",
  agent_unavailable: "The agent is unavailable. The change remains pending.",
  adapter_rejected:
    "The agent could not apply this model and effort combination.",
  acknowledgement_mismatch:
    "The agent did not confirm the requested runtime revision.",
  internal_error: "The runtime change failed. Try again.",
};

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object);
  if (actual.length !== keys.length || keys.some((key) => !(key in object))) {
    return null;
  }
  return object;
}

function isModel(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID.test(value);
}

function isName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && LOWER_HEX_64.test(value);
}

function parseSelection(value: unknown): WorkspaceRuntimeSelection | null {
  const selection = exactObject(value, ["model", "effort", "runtime_name"]);
  if (
    !selection ||
    !isModel(selection.model) ||
    !isWorkspaceReasoningEffort(selection.effort) ||
    !isName(selection.runtime_name)
  ) {
    return null;
  }
  return {
    model: selection.model,
    effort: selection.effort,
    runtimeName: selection.runtime_name,
  };
}

export function parseHostedAgentRuntimeDiscovery(
  relayInformation: unknown,
): HostedAgentRuntimeDiscovery | null {
  if (
    !relayInformation ||
    typeof relayInformation !== "object" ||
    Array.isArray(relayInformation)
  ) {
    return null;
  }
  const extension = exactObject(
    (relayInformation as Record<string, unknown>).buzz_hosted_agent_runtime,
    ["version", "controller_pubkey", "request_kind", "status_kind"],
  );
  if (
    extension?.version !== 1 ||
    typeof extension.controller_pubkey !== "string" ||
    !LOWER_HEX_64.test(extension.controller_pubkey) ||
    extension.request_kind !== KIND_HOSTED_AGENT_RUNTIME_REQUEST ||
    extension.status_kind !== KIND_HOSTED_AGENT_RUNTIME_STATUS
  ) {
    return null;
  }
  return {
    version: 1,
    controllerPubkey: extension.controller_pubkey,
    requestKind: KIND_HOSTED_AGENT_RUNTIME_REQUEST,
    statusKind: KIND_HOSTED_AGENT_RUNTIME_STATUS,
  };
}

export async function discoverHostedAgentRuntime(
  relayHttpUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<HostedAgentRuntimeDiscovery | null> {
  try {
    const response = await fetcher(relayHttpUrl, {
      headers: { Accept: "application/nostr+json" },
    });
    if (!response.ok) return null;
    return parseHostedAgentRuntimeDiscovery(await response.json());
  } catch {
    return null;
  }
}

export function parseAgentRuntimeAcknowledgement(
  value: unknown,
  controllerPubkey: string,
): AgentRuntimeAcknowledgement | null {
  const acknowledgement = exactObject(value, [
    "schema",
    "controller_pubkey",
    "revision",
    "model",
    "effort",
    "effective_name",
    "catalog_digest",
  ]);
  if (
    !acknowledgement ||
    acknowledgement.schema !== ACKNOWLEDGEMENT_SCHEMA ||
    acknowledgement.controller_pubkey !== controllerPubkey ||
    !LOWER_HEX_64.test(controllerPubkey) ||
    !Number.isSafeInteger(acknowledgement.revision) ||
    Number(acknowledgement.revision) <= 0 ||
    !isModel(acknowledgement.model) ||
    !isWorkspaceReasoningEffort(acknowledgement.effort) ||
    !isName(acknowledgement.effective_name) ||
    !isDigest(acknowledgement.catalog_digest)
  ) {
    return null;
  }
  return {
    controllerPubkey,
    revision: Number(acknowledgement.revision),
    model: acknowledgement.model,
    effort: acknowledgement.effort,
    effectiveName: acknowledgement.effective_name,
    catalogDigest: acknowledgement.catalog_digest,
  };
}

function parseRuntimeError(value: unknown): WorkspaceRuntimeError | null {
  const error = exactObject(value, ["code", "message"]);
  if (
    !error ||
    typeof error.code !== "string" ||
    typeof error.message !== "string" ||
    fixedErrors[error.code] !== error.message
  ) {
    return null;
  }
  return { code: error.code, message: error.message };
}

export function parseHostedAgentRuntimeStatusEvent(
  event: RuntimeEvent,
  agentPubkey: string,
  controllerPubkey: string,
): HostedAgentRuntimeStatus | null {
  if (
    event.kind !== KIND_HOSTED_AGENT_RUNTIME_STATUS ||
    event.pubkey !== controllerPubkey ||
    !LOWER_HEX_64.test(controllerPubkey) ||
    !LOWER_HEX_64.test(agentPubkey) ||
    event.tags.length !== 1 ||
    event.tags[0]?.length !== 2 ||
    event.tags[0]?.[0] !== "d" ||
    event.tags[0]?.[1] !== agentPubkey
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  const status = exactObject(parsed, [
    "schema",
    "agent_pubkey",
    "request_id",
    "revision",
    "state",
    "effective",
    "requested",
    "catalog_digest",
    "error",
  ]);
  const states: readonly string[] = [
    "current",
    "pending_busy",
    "applying",
    "applied",
    "failed",
  ];
  if (
    !status ||
    status.schema !== STATUS_SCHEMA ||
    status.agent_pubkey !== agentPubkey ||
    (status.request_id !== null &&
      (typeof status.request_id !== "string" ||
        !UUID_V4.test(status.request_id))) ||
    !Number.isSafeInteger(status.revision) ||
    Number(status.revision) <= 0 ||
    typeof status.state !== "string" ||
    !states.includes(status.state) ||
    !isDigest(status.catalog_digest)
  ) {
    return null;
  }
  const effective = parseSelection(status.effective);
  const requested =
    status.requested === null ? null : parseSelection(status.requested);
  const error = status.error === null ? null : parseRuntimeError(status.error);
  if (
    !effective ||
    (status.requested !== null && !requested) ||
    (status.error !== null && !error) ||
    (status.state === "failed") !== Boolean(error) ||
    (["current", "applied"].includes(status.state) && requested !== null) ||
    (["pending_busy", "applying", "failed"].includes(status.state) &&
      requested === null)
  ) {
    return null;
  }
  return {
    eventId: event.id,
    createdAt: event.created_at,
    requestId: status.request_id as string | null,
    revision: Number(status.revision),
    state: status.state as WorkspaceRuntimeStatusState,
    effective,
    requested,
    catalogDigest: status.catalog_digest,
    error,
  };
}

export function latestTrustedRuntimeStatus(
  events: RuntimeEvent[],
  agentPubkey: string,
  controllerPubkey: string,
): HostedAgentRuntimeStatus | null {
  let latest: HostedAgentRuntimeStatus | null = null;
  for (const event of events) {
    const candidate = parseHostedAgentRuntimeStatusEvent(
      event,
      agentPubkey,
      controllerPubkey,
    );
    if (
      candidate &&
      (!latest ||
        candidate.createdAt > latest.createdAt ||
        (candidate.createdAt === latest.createdAt &&
          candidate.eventId < latest.eventId))
    ) {
      latest = candidate;
    }
  }
  return latest;
}

export function projectWorkspaceAgentRuntime(
  acknowledgement: AgentRuntimeAcknowledgement | null,
  status: HostedAgentRuntimeStatus | null,
): WorkspaceAgentRuntimeProjection | null {
  if (!acknowledgement) return null;
  const effective = {
    model: acknowledgement.model,
    effort: acknowledgement.effort,
    runtimeName: acknowledgement.effectiveName,
  };
  const trustedStatus =
    status &&
    status.catalogDigest === acknowledgement.catalogDigest &&
    status.revision >= acknowledgement.revision &&
    JSON.stringify(status.effective) === JSON.stringify(effective)
      ? status
      : null;
  return trustedStatus
    ? {
        effective,
        pending: trustedStatus.requested,
        revision: trustedStatus.revision,
        state: trustedStatus.state,
        error: trustedStatus.error,
      }
    : {
        effective,
        pending: null,
        revision: acknowledgement.revision,
        state: "current",
        error: null,
      };
}

export type RuntimeRequestInput = {
  controllerPubkey: string;
  agentPubkey: string;
  requestId: string;
  model: string;
  effort: WorkspaceReasoningEffort;
  presentationEventId: string | null;
  catalogDigest: string;
  nowSeconds: number;
};

export async function buildHostedAgentRuntimeRequestTemplate(
  input: RuntimeRequestInput,
  encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>,
): Promise<{ kind: 24201; content: string; tags: string[][] }> {
  if (
    !LOWER_HEX_64.test(input.controllerPubkey) ||
    !LOWER_HEX_64.test(input.agentPubkey) ||
    !UUID_V4.test(input.requestId) ||
    !isModel(input.model) ||
    !isWorkspaceReasoningEffort(input.effort) ||
    (input.presentationEventId !== null &&
      !LOWER_HEX_64.test(input.presentationEventId)) ||
    !isDigest(input.catalogDigest) ||
    !Number.isSafeInteger(input.nowSeconds) ||
    input.nowSeconds <= 0
  ) {
    throw new Error("Invalid hosted-agent runtime request.");
  }
  const plaintext = JSON.stringify({
    schema: REQUEST_SCHEMA,
    request_id: input.requestId,
    agent_pubkey: input.agentPubkey,
    model: input.model,
    effort: input.effort,
    presentation_event_id: input.presentationEventId,
    catalog_digest: input.catalogDigest,
  });
  return {
    kind: KIND_HOSTED_AGENT_RUNTIME_REQUEST,
    content: await encrypt(input.controllerPubkey, plaintext),
    tags: [
      ["p", input.controllerPubkey],
      ["agent", input.agentPubkey],
      ["request", input.requestId],
      ["expiration", String(input.nowSeconds + 300)],
    ],
  };
}

export const HOSTED_AGENT_CONFIG_SCHEMA = "buzz.hosted-agent-config.v1";
export const KIND_MANAGED_AGENT_COMPAT = 30177;
export const KIND_HOSTED_AGENT_CONFIG = 30180;

export type HostedAgentConfigInput = {
  pubkey: string;
  name: string;
  avatarUrl: string | null;
  model: string | null;
};

export type HostedAgentConfigEvent = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
};

export function isLowercasePubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function configContent(
  event: HostedAgentConfigEvent,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const content = parsed as Record<string, unknown>;
    const expectedKeys = [
      "schema",
      "agent_pubkey",
      "name",
      "avatar_url",
      "model",
    ];
    if (
      Object.keys(content).length !== expectedKeys.length ||
      expectedKeys.some((key) => !(key in content)) ||
      content.schema !== HOSTED_AGENT_CONFIG_SCHEMA ||
      typeof content.agent_pubkey !== "string" ||
      !isLowercasePubkey(content.agent_pubkey) ||
      typeof content.name !== "string" ||
      !content.name.trim() ||
      content.name.trim().length > 256 ||
      (content.avatar_url !== null && typeof content.avatar_url !== "string") ||
      (typeof content.avatar_url === "string" &&
        content.avatar_url.length > 2_048) ||
      (content.model !== null && typeof content.model !== "string") ||
      (typeof content.model === "string" && content.model.length > 256)
    ) {
      return null;
    }
    return content;
  } catch {
    return null;
  }
}

/** Return the target only for the canonical or safely namespaced compat form. */
export function hostedAgentConfigTarget(
  event: HostedAgentConfigEvent,
): string | null {
  const content = configContent(event);
  const declared = content?.agent_pubkey;
  if (typeof declared !== "string") {
    return null;
  }
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  if (dTags.length !== 1 || dTags[0]?.length !== 2) return null;
  const dTag = dTags[0]?.[1];
  if (
    event.kind === KIND_HOSTED_AGENT_CONFIG &&
    event.tags.length === 1 &&
    dTag === declared
  ) {
    return declared;
  }
  if (
    event.kind === KIND_MANAGED_AGENT_COMPAT &&
    event.tags.length === 1 &&
    dTag === `hosted-agent:${declared}`
  ) {
    return declared;
  }
  return null;
}

/** NIP-33 tie-break: newer timestamp, then lexicographically lowest event id. */
export function isNewerReplaceableHead(
  candidate: Pick<HostedAgentConfigEvent, "created_at" | "id">,
  current: Pick<HostedAgentConfigEvent, "created_at" | "id"> | undefined,
): boolean {
  return (
    !current ||
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}

/** Build the exact public 30180 document accepted by the relay. */
export function buildHostedAgentConfigTemplate(input: HostedAgentConfigInput) {
  const pubkey = input.pubkey.trim().toLowerCase();
  const name = input.name.trim();
  if (!isLowercasePubkey(pubkey)) {
    throw new Error(
      "Hosted agent public key must be 64 lowercase hex characters.",
    );
  }
  if (!name) throw new Error("Hosted agent name is required.");
  return {
    kind: KIND_HOSTED_AGENT_CONFIG,
    content: JSON.stringify({
      schema: HOSTED_AGENT_CONFIG_SCHEMA,
      agent_pubkey: pubkey,
      name,
      avatar_url: input.avatarUrl?.trim() || null,
      model: input.model?.trim() || null,
    }),
    tags: [["d", pubkey]],
  };
}

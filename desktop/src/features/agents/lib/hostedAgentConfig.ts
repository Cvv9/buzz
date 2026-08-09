import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import {
  KIND_HOSTED_AGENT_CONFIG,
  KIND_MANAGED_AGENT,
} from "@/shared/constants/kinds";

const HOSTED_AGENT_CONFIG_SCHEMA = "buzz.hosted-agent-config.v1";

export type HostedAgentConfigInput = {
  pubkey: string;
  name: string;
  avatarUrl: string | null;
  model: string | null;
};

function isUnknownKindError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown event kind/i.test(message);
}

async function publishConfigEvent(
  kind: number,
  dTag: string,
  content: string,
): Promise<void> {
  const event = await signRelayEvent({
    kind,
    tags: [["d", dTag]],
    content,
  });
  await relayClient.publishEvent(
    event,
    "Timed out while saving the hosted agent.",
    "Could not save the hosted agent.",
  );
}

/**
 * Publish the current administrator's durable presentation/runtime preference
 * for one hosted agent. The agent pubkey is the NIP-33 coordinate; no agent
 * secret or provider credential ever crosses this boundary.
 */
export async function publishHostedAgentConfig(
  input: HostedAgentConfigInput,
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error("Agent name is required.");

  const pubkey = input.pubkey.toLowerCase();
  const content = JSON.stringify({
    schema: HOSTED_AGENT_CONFIG_SCHEMA,
    agent_pubkey: pubkey,
    name,
    avatar_url: input.avatarUrl?.trim() || null,
    model: input.model?.trim() || null,
  });

  try {
    await publishConfigEvent(KIND_HOSTED_AGENT_CONFIG, pubkey, content);
  } catch (error) {
    if (!isUnknownKindError(error)) throw error;

    // Compatibility path for relays deployed before kind:30180 existed.
    // Kind:30177 is already an owner-authored, global NIP-33 document. A
    // namespaced d-tag and schema marker keep this projection disjoint from
    // real managed-agent definitions while allowing mixed-version fleets to
    // save names, avatars, and model preferences immediately. Never fall back
    // to 30179: that coordinate is a private managed-agent aggregate.
    await publishConfigEvent(
      KIND_MANAGED_AGENT,
      `hosted-agent:${pubkey}`,
      content,
    );
  }
}

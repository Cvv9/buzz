import { type NostrEvent, publishEvent } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  buildHostedAgentConfigTemplate,
  type HostedAgentConfigInput,
} from "./workspace-hosted-agent-config-policy";

/** Build the canonical, public hosted-agent presentation configuration. */
export const hostedAgentConfigTemplate = buildHostedAgentConfigTemplate;

/** Publish an owner-authored presentation overlay for a hosted directory entry. */
export function publishHostedAgentConfig(
  input: HostedAgentConfigInput,
): Promise<NostrEvent> {
  return publishEvent(relayWsUrl(), buildHostedAgentConfigTemplate(input));
}

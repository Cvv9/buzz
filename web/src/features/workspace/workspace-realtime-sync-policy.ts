/**
 * Cache boundaries affected by an inbound workspace relay event. Keeping this
 * mapping pure lets subscriptions coalesce repeated replaceable heads without
 * guessing from UI state.
 */
export type WorkspaceRealtimeEvent = {
  kind: number;
  tags: string[][];
};

export type WorkspaceInvalidationTarget = "channels" | "agents";

const CHANNEL_METADATA = 39000;
const CHANNEL_MEMBERS = 39002;
const AGENT_PROFILE = 10100;
const MANAGED_AGENT_COMPAT = 30177;
const HOSTED_AGENT_CONFIG = 30180;
const HOSTED_AGENT_RUNTIME_STATUS = 30181;
const COMMUNITY_MEMBERS = 13534;
const MEMBER_ADDED = 44100;
const MEMBER_REMOVED = 44101;

function isForViewer(event: WorkspaceRealtimeEvent, viewerPubkey: string) {
  const viewer = viewerPubkey.toLowerCase();
  return event.tags.some(
    (tag) => tag[0] === "p" && tag[1]?.toLowerCase() === viewer,
  );
}

/** Return every cache whose source-of-truth may have changed. */
export function workspaceInvalidationTargets(
  event: WorkspaceRealtimeEvent,
  viewerPubkey: string,
): WorkspaceInvalidationTarget[] {
  switch (event.kind) {
    case CHANNEL_METADATA:
    case CHANNEL_MEMBERS:
      return ["channels"];
    case AGENT_PROFILE:
    case MANAGED_AGENT_COMPAT:
    case HOSTED_AGENT_CONFIG:
    case HOSTED_AGENT_RUNTIME_STATUS:
      return ["agents"];
    case COMMUNITY_MEMBERS:
      return ["channels", "agents"];
    case MEMBER_ADDED:
    case MEMBER_REMOVED:
      return isForViewer(event, viewerPubkey) ? ["channels"] : [];
    default:
      return [];
  }
}

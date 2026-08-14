export const SEARCHABLE_EVENT_KINDS = [
  9, // NIP-01 text note / legacy stream message
  40002, // Buzz stream message
  45001, // forum post
  45003, // forum comment
  30617, // repository announcement
  30621, // multi-repository project
  1617, // git patch
  1618, // pull request
  1619, // pull-request update
  1621, // git issue
] as const;

export type SearchFormFilters = {
  query: string;
  channelId?: string;
  author?: string;
  since?: string;
  until?: string;
};

export type SearchFilters = {
  query: string;
  channelId?: string;
  author?: string;
  since?: number;
  until?: number;
};

export type SearchableEvent = {
  id: string;
  kind: number;
  pubkey: string;
  tags: string[][];
};

export type SearchDestination =
  | { kind: "workspace"; href: string; label: string }
  | { kind: "repo"; href: string; label: string }
  | { kind: "unavailable"; label: string };

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? Math.floor(milliseconds / 1_000)
    : undefined;
}

function validOptionalPubkey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Author must be a 64-character hexadecimal public key.");
  }
  return normalized;
}

/** Validate browser inputs before creating an explicit-kind NIP-50 filter. */
export function normalizeSearchFilters(
  input: SearchFormFilters,
): SearchFilters {
  const query = input.query.trim();
  if (query.length < 2) {
    throw new Error("Enter at least two characters to search.");
  }
  const since = parseDate(input.since);
  const until = parseDate(input.until);
  if (input.since && since === undefined)
    throw new Error("Choose a valid start time.");
  if (input.until && until === undefined)
    throw new Error("Choose a valid end time.");
  if (since !== undefined && until !== undefined && since > until) {
    throw new Error("The start time must be before the end time.");
  }
  const channelId = input.channelId?.trim() || undefined;
  return {
    query,
    channelId,
    author: validOptionalPubkey(input.author),
    since,
    until,
  };
}

function tagValue(event: SearchableEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function rootEventId(event: SearchableEvent): string | undefined {
  return (
    event.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1] ??
    event.tags.find((tag) => tag[0] === "e")?.[1]
  );
}

function repositoryIdFromProject(event: SearchableEvent): string | undefined {
  const coordinate = event.tags.find(
    (tag) => tag[0] === "a" && tag[1]?.startsWith("30617:"),
  )?.[1];
  if (!coordinate) return undefined;
  const parts = coordinate.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : undefined;
}

/**
 * Browser routes are intentionally only emitted where the browser currently
 * has a destination. Forum/project results retain their kind-specific label
 * and fall back to their channel/repository instead of inventing a route.
 */
export function searchDestination(event: SearchableEvent): SearchDestination {
  const channelId = tagValue(event, "h");
  if (event.kind === 30617) {
    const repoId = tagValue(event, "d") ?? event.id;
    return {
      kind: "repo",
      href: `/repos/${encodeURIComponent(repoId)}`,
      label: "Open repository",
    };
  }
  if (event.kind === 30621) {
    const repoId = repositoryIdFromProject(event);
    if (repoId) {
      return {
        kind: "repo",
        href: `/repos/${encodeURIComponent(repoId)}`,
        label: "Open a project repository",
      };
    }
    return {
      kind: "unavailable",
      label: "Project detail is not available in the browser yet",
    };
  }
  if (channelId) {
    if (event.kind === 45001 || event.kind === 45003) {
      const postId =
        event.kind === 45001 ? event.id : (rootEventId(event) ?? event.id);
      return {
        kind: "workspace",
        href: `/channels/${encodeURIComponent(channelId)}/posts/${encodeURIComponent(postId)}`,
        label: "Open forum post",
      };
    }
    const parameters = new URLSearchParams({ channel: channelId });
    const root = rootEventId(event);
    parameters.set("thread", root ?? event.id);
    return {
      kind: "workspace",
      href: `/?${parameters.toString()}`,
      label: "Open channel thread",
    };
  }
  return {
    kind: "unavailable",
    label: "This result has no browser destination",
  };
}

/**
 * Resolve the primary author label for a result. Returns a trimmed profile
 * display name only when it is present and distinct from the truncated pubkey;
 * a profile whose name defaulted to the truncated pubkey adds no information, so
 * the caller should render the truncated pubkey alone in that case.
 */
export function searchAuthorDisplayName(
  profileName: string | undefined,
  truncatedPubkey: string,
): string | null {
  const trimmed = profileName?.trim();
  return trimmed && trimmed !== truncatedPubkey ? trimmed : null;
}

export function searchKindLabel(kind: number): string {
  switch (kind) {
    case 9:
    case 40002:
      return "Message";
    case 45001:
      return "Forum post";
    case 45003:
      return "Forum reply";
    case 30617:
      return "Repository";
    case 30621:
      return "Project";
    case 1617:
      return "Patch";
    case 1618:
      return "Pull request";
    case 1619:
      return "Pull request update";
    case 1621:
      return "Issue";
    default:
      return `Event ${kind}`;
  }
}

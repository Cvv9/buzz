import {
  queryEvents,
  subscribeEvents,
  type NostrEvent,
  type NostrFilter,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  buildProjectCollection,
  buildRepositoryActivity,
  buildRepositoryWorkItems,
  KIND_DELETION,
  KIND_GIT_ISSUE,
  KIND_GIT_PR_UPDATE,
  KIND_GIT_PULL_REQUEST,
  KIND_GIT_STATUS_CLOSED,
  KIND_GIT_STATUS_DRAFT,
  KIND_GIT_STATUS_MERGED,
  KIND_GIT_STATUS_OPEN,
  KIND_PROJECT,
  KIND_REPOSITORY,
  KIND_TEXT_NOTE,
  parseProjectCoordinate,
  parseRepositoryCoordinate,
  type ProjectCollection,
} from "./project-policy";

const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const ADDRESS_FILTER_CHUNK = 100;

export type RelayPage<T> = {
  events: T[];
  possiblyIncomplete: boolean;
};

export type BrowserProjectCollection = ProjectCollection & {
  possiblyIncomplete: boolean;
};

export type BrowserRepositoryWorkItems = {
  items: ReturnType<typeof buildRepositoryWorkItems>;
  activity: ReturnType<typeof buildRepositoryActivity>;
  possiblyIncomplete: boolean;
};

function deduplicateEvents(events: NostrEvent[]): NostrEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

/**
 * Read a finite relay history without trusting a short page to prove that a
 * timestamp bucket is complete. NIP-01's `until` is inclusive, so exact
 * boundary events are drained before advancing the cursor.
 */
export async function queryPaginatedEvents(
  filter: NostrFilter,
): Promise<RelayPage<NostrEvent>> {
  const events: NostrEvent[] = [];
  const seen = new Set<string>();
  let until = filter.until;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const pageEvents = await queryEvents(relayWsUrl(), {
      ...filter,
      until,
      limit: PAGE_SIZE,
    });
    for (const event of pageEvents) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        events.push(event);
      }
    }
    if (pageEvents.length < PAGE_SIZE)
      return { events, possiblyIncomplete: false };
    const oldest = Math.min(...pageEvents.map((event) => event.created_at));
    const boundary = await queryEvents(relayWsUrl(), {
      ...filter,
      since: oldest,
      until: oldest,
      limit: PAGE_SIZE,
    });
    for (const event of boundary) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        events.push(event);
      }
    }
    if (boundary.length >= PAGE_SIZE || oldest === 0) {
      return { events, possiblyIncomplete: true };
    }
    until = oldest - 1;
  }
  return { events, possiblyIncomplete: true };
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push([...values.slice(index, index + size)]);
  }
  return result;
}

async function queryAddressableDeletions(
  addresses: string[],
): Promise<RelayPage<NostrEvent>> {
  const pages = await Promise.all(
    chunks(addresses, ADDRESS_FILTER_CHUNK).map((addressChunk) =>
      queryPaginatedEvents({ kinds: [KIND_DELETION], "#a": addressChunk }),
    ),
  );
  return {
    events: deduplicateEvents(pages.flatMap((page) => page.events)),
    possiblyIncomplete: pages.some((page) => page.possiblyIncomplete),
  };
}

/** List global NIP-MP project containers and unclaimed NIP-34 repositories. */
export async function listBrowserProjects(): Promise<BrowserProjectCollection> {
  const [projects, repositories] = await Promise.all([
    queryPaginatedEvents({ kinds: [KIND_PROJECT] }),
    queryPaginatedEvents({ kinds: [KIND_REPOSITORY] }),
  ]);
  const addresses = deduplicateEvents([
    ...projects.events,
    ...repositories.events,
  ]).flatMap((event) => {
    const dtag = event.tags.filter((tag) => tag[0] === "d");
    if (dtag.length !== 1 || typeof dtag[0]?.[1] !== "string") return [];
    const address = `${event.kind}:${event.pubkey}:${dtag[0][1]}`;
    return parseProjectCoordinate(address) || parseRepositoryCoordinate(address)
      ? [address]
      : [];
  });
  const deletions = addresses.length
    ? await queryAddressableDeletions(addresses)
    : { events: [], possiblyIncomplete: false };
  return {
    ...buildProjectCollection({
      projectEvents: projects.events,
      repositoryEvents: repositories.events,
      deletionEvents: deletions.events,
    }),
    possiblyIncomplete:
      projects.possiblyIncomplete ||
      repositories.possiblyIncomplete ||
      deletions.possiblyIncomplete,
  };
}

/** Return a strict project only when its canonical coordinate is addressable. */
export async function getBrowserProject(projectAddress: string) {
  if (!parseProjectCoordinate(projectAddress)) return null;
  const collection = await listBrowserProjects();
  return (
    collection.containers.find(
      (project) => project.address === projectAddress,
    ) ?? null
  );
}

/**
 * List root work items plus their NIP-34 updates, statuses, comments and
 * activity. Every relay query has both explicit kinds and one exact `a` tag.
 */
export async function listRepositoryWorkItems(
  repositoryAddress: string,
): Promise<BrowserRepositoryWorkItems> {
  if (!parseRepositoryCoordinate(repositoryAddress)) {
    throw new Error("Repository links must use a canonical 30617 address.");
  }
  const scoped = { "#a": [repositoryAddress] } satisfies NostrFilter;
  const [roots, updates, comments, statuses, patches] = await Promise.all([
    queryPaginatedEvents({
      ...scoped,
      kinds: [KIND_GIT_ISSUE, KIND_GIT_PULL_REQUEST],
    }),
    queryPaginatedEvents({ ...scoped, kinds: [KIND_GIT_PR_UPDATE] }),
    queryPaginatedEvents({ ...scoped, kinds: [KIND_TEXT_NOTE] }),
    queryPaginatedEvents({
      ...scoped,
      kinds: [
        KIND_GIT_STATUS_OPEN,
        KIND_GIT_STATUS_MERGED,
        KIND_GIT_STATUS_CLOSED,
        KIND_GIT_STATUS_DRAFT,
      ],
    }),
    queryPaginatedEvents({ ...scoped, kinds: [1617] }),
  ]);
  const items = buildRepositoryWorkItems({
    repositoryAddress,
    rootEvents: roots.events,
    updateEvents: updates.events,
    commentEvents: comments.events,
    statusEvents: statuses.events,
  });
  const activity = buildRepositoryActivity({
    repositoryAddress,
    events: deduplicateEvents([
      ...roots.events,
      ...updates.events,
      ...comments.events,
      ...statuses.events,
      ...patches.events,
    ]),
    workItems: items,
  });
  return {
    items,
    activity,
    possiblyIncomplete: [roots, updates, comments, statuses, patches].some(
      (page) => page.possiblyIncomplete,
    ),
  };
}

/** Subscribe to replacement heads; callers query again to fold deletes safely. */
export function subscribeToBrowserProjects(onChange: () => void): () => void {
  return subscribeEvents(
    relayWsUrl(),
    { kinds: [KIND_PROJECT, KIND_REPOSITORY] },
    onChange,
  );
}

/** Subscribe to known `a` coordinates so NIP-09 deletions invalidate collection caches. */
export function subscribeToProjectDeletions(
  addresses: string[],
  onChange: () => void,
): () => void {
  const stops = chunks(addresses, ADDRESS_FILTER_CHUNK).map((addressChunk) =>
    subscribeEvents(
      relayWsUrl(),
      { kinds: [KIND_DELETION], "#a": addressChunk },
      onChange,
    ),
  );
  return () => {
    for (const stop of stops) stop();
  };
}

/** A single repository-address subscription covers all read-only work-item projections. */
export function subscribeToRepositoryWorkItems(
  repositoryAddress: string,
  onChange: () => void,
): () => void {
  if (!parseRepositoryCoordinate(repositoryAddress)) return () => {};
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [
        KIND_GIT_ISSUE,
        KIND_GIT_PULL_REQUEST,
        KIND_GIT_PR_UPDATE,
        KIND_TEXT_NOTE,
        KIND_GIT_STATUS_OPEN,
        KIND_GIT_STATUS_MERGED,
        KIND_GIT_STATUS_CLOSED,
        KIND_GIT_STATUS_DRAFT,
        1617,
      ],
      "#a": [repositoryAddress],
    },
    onChange,
  );
}

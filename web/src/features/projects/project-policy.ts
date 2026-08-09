import type { NostrEvent } from "@/shared/lib/nostr-client";

export const KIND_PROJECT = 30621;
export const KIND_REPOSITORY = 30617;
export const KIND_DELETION = 5;
export const KIND_GIT_PATCH = 1617;
export const KIND_GIT_PULL_REQUEST = 1618;
export const KIND_GIT_PR_UPDATE = 1619;
export const KIND_GIT_ISSUE = 1621;
export const KIND_GIT_STATUS_OPEN = 1630;
export const KIND_GIT_STATUS_MERGED = 1631;
export const KIND_GIT_STATUS_CLOSED = 1632;
export const KIND_GIT_STATUS_DRAFT = 1633;
export const KIND_TEXT_NOTE = 1;

export const WORK_ITEM_KINDS = [KIND_GIT_ISSUE, KIND_GIT_PULL_REQUEST] as const;
export const WORK_ITEM_ACTIVITY_KINDS = [
  KIND_GIT_PATCH,
  KIND_GIT_PULL_REQUEST,
  KIND_GIT_PR_UPDATE,
  KIND_GIT_ISSUE,
  KIND_GIT_STATUS_OPEN,
  KIND_GIT_STATUS_MERGED,
  KIND_GIT_STATUS_CLOSED,
  KIND_GIT_STATUS_DRAFT,
  KIND_TEXT_NOTE,
] as const;

const EVENT_ID = /^[0-9a-f]{64}$/;
const MAX_D_TAG_BYTES = 1024;
const MAX_PROJECT_MEMBERS = 64;
const MAX_PROJECT_CONTENT_BYTES = 64 * 1024;
const MAX_EVENT_TAGS = 256;
const MAX_TAG_VALUES = 16;

export type RepositoryCoordinate = {
  address: string;
  owner: string;
  dtag: string;
};

export type ProjectCoordinate = {
  address: string;
  owner: string;
  dtag: string;
};

export type BrowserRepository = RepositoryCoordinate & {
  id: string;
  name: string;
  description: string;
  cloneUrls: string[];
  webUrl: string | null;
  channelId: string | null;
  contributors: string[];
  maintainers: string[];
  createdAt: number;
  eventId: string;
};

export type BrowserProject = ProjectCoordinate & {
  id: string;
  name: string;
  description: string;
  channelId: string | null;
  visibility: "listed" | "unlisted";
  memberAddresses: string[];
  createdAt: number;
  eventId: string;
};

export type ProjectMember = {
  coordinate: RepositoryCoordinate;
  repository: BrowserRepository | null;
  claimed: boolean;
};

export type ProjectContainer = BrowserProject & {
  members: ProjectMember[];
};

export type ProjectCollection = {
  containers: ProjectContainer[];
  implicitRepositories: BrowserRepository[];
};

export type WorkItemStatus = "Open" | "Merged" | "Closed" | "Draft";

export type WorkItemComment = {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  labels: string[];
  review: "approval" | "changes-requested" | "review-request" | null;
  commit: string | null;
};

export type WorkItemUpdate = {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  commit: string | null;
};

export type BrowserWorkItem = {
  id: string;
  repositoryAddress: string;
  kind: "issue" | "pull-request";
  title: string;
  content: string;
  author: string;
  labels: string[];
  recipients: string[];
  createdAt: number;
  updatedAt: number;
  status: WorkItemStatus;
  comments: WorkItemComment[];
  updates: WorkItemUpdate[];
  reviewers: string[];
  approvals: WorkItemComment[];
  changeRequests: WorkItemComment[];
  commit: string | null;
};

export type RepositoryActivity = {
  id: string;
  kind: number;
  author: string;
  content: string;
  createdAt: number;
  workItemId: string | null;
};

type ValidEnvelope = NostrEvent & { tags: string[][] };

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLowerPubkey(value: unknown): value is string {
  return typeof value === "string" && EVENT_ID.test(value);
}

function validDTag(value: string): boolean {
  return value.length > 0 && byteLength(value) <= MAX_D_TAG_BYTES;
}

function eventTags(value: unknown): string[][] | null {
  if (!Array.isArray(value) || value.length > MAX_EVENT_TAGS) return null;
  const tags: string[][] = [];
  for (const tag of value) {
    if (
      !Array.isArray(tag) ||
      tag.length === 0 ||
      tag.length > MAX_TAG_VALUES ||
      tag.some((part) => typeof part !== "string")
    ) {
      return null;
    }
    tags.push(tag);
  }
  return tags;
}

function validEnvelope(event: NostrEvent): event is ValidEnvelope {
  return (
    EVENT_ID.test(event.id) &&
    isLowerPubkey(event.pubkey) &&
    Number.isSafeInteger(event.created_at) &&
    event.created_at >= 0 &&
    typeof event.content === "string" &&
    eventTags(event.tags) !== null
  );
}

function tagsOf(event: ValidEnvelope): string[][] {
  return event.tags;
}

function exactTag(tags: string[][], name: string): string | null {
  const matches = tags.filter((tag) => tag[0] === name);
  return matches.length === 1 && nonEmpty(matches[0]?.[1])
    ? matches[0][1]
    : null;
}

function optionalTag(tags: string[][], name: string): string | null {
  const matches = tags.filter((tag) => tag[0] === name);
  if (matches.length === 0) return null;
  return matches.length === 1 && nonEmpty(matches[0]?.[1])
    ? matches[0][1]
    : null;
}

function tagValues(tags: string[][], name: string): string[] {
  return tags
    .filter((tag) => tag[0] === name && nonEmpty(tag[1]))
    .map((tag) => tag[1]);
}

function latestByCoordinate<T extends { createdAt: number; eventId: string }>(
  entries: T[],
  key: (entry: T) => string,
): T[] {
  const heads = new Map<string, T>();
  for (const entry of entries) {
    const current = heads.get(key(entry));
    if (
      !current ||
      entry.createdAt > current.createdAt ||
      (entry.createdAt === current.createdAt && entry.eventId < current.eventId)
    ) {
      heads.set(key(entry), entry);
    }
  }
  return [...heads.values()];
}

/** Parse an exact NIP-01 `30617:<owner>:<d>` repository coordinate. */
export function parseRepositoryCoordinate(
  value: string,
): RepositoryCoordinate | null {
  const first = value.indexOf(":");
  const second = value.indexOf(":", first + 1);
  if (first < 0 || second < 0 || value.slice(0, first) !== "30617") {
    return null;
  }
  const owner = value.slice(first + 1, second);
  const dtag = value.slice(second + 1);
  if (!isLowerPubkey(owner) || !validDTag(dtag)) return null;
  return { address: `30617:${owner}:${dtag}`, owner, dtag };
}

/** Parse an exact NIP-MP `30621:<owner>:<d>` project coordinate. */
export function parseProjectCoordinate(
  value: string,
): ProjectCoordinate | null {
  const first = value.indexOf(":");
  const second = value.indexOf(":", first + 1);
  if (first < 0 || second < 0 || value.slice(0, first) !== "30621") {
    return null;
  }
  const owner = value.slice(first + 1, second);
  const dtag = value.slice(second + 1);
  if (!isLowerPubkey(owner) || !validDTag(dtag)) return null;
  return { address: `30621:${owner}:${dtag}`, owner, dtag };
}

/** Strictly project a NIP-34 repository announcement. */
export function parseRepositoryEvent(
  event: NostrEvent,
): BrowserRepository | null {
  if (event.kind !== KIND_REPOSITORY || !validEnvelope(event)) return null;
  const tags = tagsOf(event);
  const dtag = exactTag(tags, "d");
  if (!dtag || !validDTag(dtag)) return null;

  const coordinate = parseRepositoryCoordinate(`30617:${event.pubkey}:${dtag}`);
  if (!coordinate) return null;
  const name = optionalTag(tags, "name") ?? dtag;
  const description = optionalTag(tags, "description") ?? event.content;
  const webUrl = optionalTag(tags, "web");
  const safeWebUrl =
    webUrl && /^https?:$/i.test(safeUrlProtocol(webUrl)) ? webUrl : null;
  return {
    ...coordinate,
    id: `${coordinate.owner}:${coordinate.dtag}`,
    name,
    description,
    cloneUrls: tagValues(tags, "clone"),
    webUrl: safeWebUrl,
    channelId: optionalTag(tags, "buzz-channel"),
    contributors: tagValues(tags, "p").filter(isLowerPubkey),
    maintainers: tagValues(tags, "maintainers").filter(isLowerPubkey),
    createdAt: event.created_at,
    eventId: event.id,
  };
}

function safeUrlProtocol(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return "";
  }
}

/** Strictly project a NIP-MP project, including its bounded repo membership. */
export function parseProjectEvent(event: NostrEvent): BrowserProject | null {
  if (
    event.kind !== KIND_PROJECT ||
    !validEnvelope(event) ||
    byteLength(event.content) > MAX_PROJECT_CONTENT_BYTES
  ) {
    return null;
  }
  const tags = tagsOf(event);
  const dtag = exactTag(tags, "d");
  if (!dtag || !validDTag(dtag)) return null;
  for (const tagName of [
    "name",
    "description",
    "buzz-channel",
    "buzz-visibility",
  ]) {
    if (tags.filter((tag) => tag[0] === tagName).length > 1) return null;
  }
  const name = optionalTag(tags, "name") ?? dtag;
  const description = optionalTag(tags, "description") ?? "";
  const channelId = optionalTag(tags, "buzz-channel");
  const rawVisibility = optionalTag(tags, "buzz-visibility");
  if (
    byteLength(name) > 256 ||
    byteLength(description) > 2048 ||
    (channelId && byteLength(channelId) > 256) ||
    (rawVisibility &&
      rawVisibility !== "listed" &&
      rawVisibility !== "unlisted")
  ) {
    return null;
  }
  const memberTags = tags.filter((tag) => tag[0] === "a");
  if (memberTags.length > MAX_PROJECT_MEMBERS) return null;
  const members: string[] = [];
  const seen = new Set<string>();
  for (const tag of memberTags) {
    if (tag.length !== 2 && tag.length !== 3) return null;
    const coordinate = parseRepositoryCoordinate(tag[1] ?? "");
    if (!coordinate || seen.has(coordinate.address)) return null;
    seen.add(coordinate.address);
    members.push(coordinate.address);
  }
  const coordinate = parseProjectCoordinate(`30621:${event.pubkey}:${dtag}`);
  if (!coordinate) return null;
  return {
    ...coordinate,
    id: coordinate.address,
    name,
    description,
    channelId,
    visibility: rawVisibility === "unlisted" ? "unlisted" : "listed",
    memberAddresses: members,
    createdAt: event.created_at,
    eventId: event.id,
  };
}

type Deletion = { address: string; createdAt: number };

function parseDeletionEvents(events: NostrEvent[]): Deletion[] {
  const deletions: Deletion[] = [];
  for (const event of events) {
    if (event.kind !== KIND_DELETION || !validEnvelope(event)) continue;
    for (const tag of tagsOf(event)) {
      if (tag[0] !== "a" || !nonEmpty(tag[1])) continue;
      const address = tag[1];
      const coordinate =
        parseRepositoryCoordinate(address) ?? parseProjectCoordinate(address);
      if (!coordinate || coordinate.owner !== event.pubkey) continue;
      deletions.push({
        address: coordinate.address,
        createdAt: event.created_at,
      });
    }
  }
  return deletions;
}

function isDeleted(
  address: string,
  createdAt: number,
  deletions: readonly Deletion[],
): boolean {
  return deletions.some(
    (deletion) =>
      deletion.address === address && deletion.createdAt >= createdAt,
  );
}

/** Build NIP-MP containers plus unclaimed implicit repository cards. */
export function buildProjectCollection(input: {
  projectEvents: NostrEvent[];
  repositoryEvents: NostrEvent[];
  deletionEvents?: NostrEvent[];
}): ProjectCollection {
  const deletions = parseDeletionEvents(input.deletionEvents ?? []);
  const repositories = latestByCoordinate(
    input.repositoryEvents.flatMap((event) => {
      const repository = parseRepositoryEvent(event);
      return repository &&
        !isDeleted(repository.address, repository.createdAt, deletions)
        ? [repository]
        : [];
    }),
    (repository) => repository.address,
  );
  const repositoriesByAddress = new Map(
    repositories.map((repository) => [repository.address, repository]),
  );
  const projects = latestByCoordinate(
    input.projectEvents.flatMap((event) => {
      const project = parseProjectEvent(event);
      return project &&
        !isDeleted(project.address, project.createdAt, deletions)
        ? [project]
        : [];
    }),
    (project) => project.address,
  ).filter((project) => project.visibility === "listed");

  const claimedRepositories = new Set<string>();
  const containers = projects.map((project) => {
    const members = project.memberAddresses.map((address) => {
      const coordinate = parseRepositoryCoordinate(address);
      const repository = coordinate
        ? (repositoriesByAddress.get(address) ?? null)
        : null;
      const claimed = Boolean(
        repository &&
          (repository.owner === project.owner ||
            repository.maintainers.includes(project.owner)),
      );
      if (claimed) claimedRepositories.add(address);
      return {
        coordinate: coordinate ?? {
          address,
          owner: "",
          dtag: "unavailable",
        },
        repository,
        claimed,
      };
    });
    return { ...project, members };
  });

  return {
    containers: containers.sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        left.eventId.localeCompare(right.eventId),
    ),
    implicitRepositories: repositories
      .filter((repository) => !claimedRepositories.has(repository.address))
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          left.eventId.localeCompare(right.eventId),
      ),
  };
}

function workItemRoot(
  event: NostrEvent,
  repositoryAddress: string,
): {
  kind: "issue" | "pull-request";
  title: string;
  labels: string[];
  recipients: string[];
} | null {
  if (
    !validEnvelope(event) ||
    (event.kind !== KIND_GIT_ISSUE && event.kind !== KIND_GIT_PULL_REQUEST)
  ) {
    return null;
  }
  const tags = tagsOf(event);
  if (exactTag(tags, "a") !== repositoryAddress) return null;
  const title =
    optionalTag(tags, "subject") ?? event.content.split("\n")[0]?.trim();
  if (!title) return null;
  return {
    kind: event.kind === KIND_GIT_ISSUE ? "issue" : "pull-request",
    title,
    labels: tagValues(tags, "t"),
    recipients: tagValues(tags, "p").filter(isLowerPubkey),
  };
}

function linkedRootId(
  event: NostrEvent,
  repositoryAddress: string,
): string | null {
  if (
    !validEnvelope(event) ||
    exactTag(tagsOf(event), "a") !== repositoryAddress
  ) {
    return null;
  }
  const links = tagsOf(event)
    .filter(
      (tag) =>
        (tag[0] === "e" || tag[0] === "E") && EVENT_ID.test(tag[1] ?? ""),
    )
    .map((tag) => tag[1] as string);
  return links.length === 1 ? links[0] : null;
}

function allowedLifecycleActors(
  root: NostrEvent,
  repositoryAddress: string,
): Set<string> {
  const repository = parseRepositoryCoordinate(repositoryAddress);
  return new Set([root.pubkey, repository?.owner].filter(isLowerPubkey));
}

function statusFor(kind: number): WorkItemStatus | null {
  switch (kind) {
    case KIND_GIT_STATUS_OPEN:
      return "Open";
    case KIND_GIT_STATUS_MERGED:
      return "Merged";
    case KIND_GIT_STATUS_CLOSED:
      return "Closed";
    case KIND_GIT_STATUS_DRAFT:
      return "Draft";
    default:
      return null;
  }
}

function eventSort(left: NostrEvent, right: NostrEvent): number {
  return left.created_at - right.created_at || left.id.localeCompare(right.id);
}

/** Strictly assemble NIP-34 work items from repository-scoped event groups. */
export function buildRepositoryWorkItems(input: {
  repositoryAddress: string;
  rootEvents: NostrEvent[];
  updateEvents?: NostrEvent[];
  commentEvents?: NostrEvent[];
  statusEvents?: NostrEvent[];
}): BrowserWorkItem[] {
  const roots = input.rootEvents
    .flatMap((event) => {
      const root = workItemRoot(event, input.repositoryAddress);
      return root ? [{ event, root }] : [];
    })
    .sort((left, right) => eventSort(left.event, right.event));
  const comments = input.commentEvents ?? [];
  const updates = input.updateEvents ?? [];
  const statuses = input.statusEvents ?? [];

  return roots
    .map(({ event, root }) => {
      const allowedActors = allowedLifecycleActors(
        event,
        input.repositoryAddress,
      );
      const workComments = comments
        .flatMap((comment) => {
          if (comment.kind !== KIND_TEXT_NOTE || !validEnvelope(comment))
            return [];
          if (linkedRootId(comment, input.repositoryAddress) !== event.id)
            return [];
          const labels = tagValues(tagsOf(comment), "t").map((label) =>
            label.toLowerCase(),
          );
          const review = labels.includes("approval")
            ? "approval"
            : labels.includes("changes-requested")
              ? "changes-requested"
              : labels.includes("review-request")
                ? "review-request"
                : null;
          return [
            {
              id: comment.id,
              author: comment.pubkey,
              content: comment.content,
              createdAt: comment.created_at,
              labels,
              review,
              commit: optionalTag(tagsOf(comment), "c"),
            } satisfies WorkItemComment,
          ];
        })
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.id.localeCompare(right.id),
        );
      const workUpdates =
        root.kind === "pull-request"
          ? updates
              .flatMap((update) => {
                if (
                  update.kind !== KIND_GIT_PR_UPDATE ||
                  !validEnvelope(update) ||
                  !allowedActors.has(update.pubkey) ||
                  linkedRootId(update, input.repositoryAddress) !== event.id
                ) {
                  return [];
                }
                return [
                  {
                    id: update.id,
                    author: update.pubkey,
                    content: update.content,
                    createdAt: update.created_at,
                    commit: optionalTag(tagsOf(update), "c"),
                  } satisfies WorkItemUpdate,
                ];
              })
              .sort(
                (left, right) =>
                  left.createdAt - right.createdAt ||
                  left.id.localeCompare(right.id),
              )
          : [];
      const latestStatus = statuses
        .filter(
          (status) =>
            statusFor(status.kind) &&
            allowedActors.has(status.pubkey) &&
            linkedRootId(status, input.repositoryAddress) === event.id,
        )
        .sort(eventSort)
        .slice(-1)[0];
      const reviewers = new Set(root.recipients);
      for (const comment of workComments) {
        if (
          comment.review === "review-request" &&
          allowedActors.has(comment.author)
        ) {
          const source = comments.find((event) => event.id === comment.id);
          if (source && validEnvelope(source)) {
            for (const pubkey of tagValues(tagsOf(source), "p").filter(
              isLowerPubkey,
            )) {
              reviewers.add(pubkey);
            }
          }
        }
      }
      reviewers.delete(event.pubkey);
      const trustedReviewers = new Set([...reviewers, ...allowedActors]);
      const initialCommit = optionalTag(tagsOf(event), "c");
      const latestCommit =
        workUpdates[workUpdates.length - 1]?.commit ?? initialCommit;
      const currentReviewByAuthor = new Map<string, WorkItemComment>();
      for (const comment of workComments) {
        if (
          !comment.review ||
          comment.review === "review-request" ||
          !trustedReviewers.has(comment.author) ||
          !latestCommit ||
          (comment.commit ?? initialCommit) !== latestCommit
        ) {
          continue;
        }
        const current = currentReviewByAuthor.get(comment.author);
        if (
          !current ||
          comment.createdAt > current.createdAt ||
          (comment.createdAt === current.createdAt && comment.id < current.id)
        ) {
          currentReviewByAuthor.set(comment.author, comment);
        }
      }
      const reviews = [...currentReviewByAuthor.values()];
      const changedAt = Math.max(
        event.created_at,
        ...workComments.map((comment) => comment.createdAt),
        ...workUpdates.map((update) => update.createdAt),
        latestStatus?.created_at ?? 0,
      );
      return {
        id: event.id,
        repositoryAddress: input.repositoryAddress,
        kind: root.kind,
        title: root.title,
        content: event.content,
        author: event.pubkey,
        labels: root.labels,
        recipients: root.recipients,
        createdAt: event.created_at,
        updatedAt: changedAt,
        status:
          statusFor(latestStatus?.kind ?? 0) ??
          (root.kind === "pull-request" &&
          root.labels.some((label) => label.toLowerCase() === "draft")
            ? "Draft"
            : "Open"),
        comments: workComments,
        updates: workUpdates,
        reviewers: [...reviewers].sort(),
        approvals: reviews.filter((comment) => comment.review === "approval"),
        changeRequests: reviews.filter(
          (comment) => comment.review === "changes-requested",
        ),
        commit: latestCommit,
      } satisfies BrowserWorkItem;
    })
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    );
}

/** Project work-item activity only keeps event kinds with a valid repo/root edge. */
export function buildRepositoryActivity(input: {
  repositoryAddress: string;
  events: NostrEvent[];
  workItems: BrowserWorkItem[];
}): RepositoryActivity[] {
  const rootIds = new Set(input.workItems.map((workItem) => workItem.id));
  return input.events
    .flatMap((event) => {
      if (
        !validEnvelope(event) ||
        !WORK_ITEM_ACTIVITY_KINDS.includes(event.kind as 1)
      ) {
        return [];
      }
      const tags = tagsOf(event);
      if (exactTag(tags, "a") !== input.repositoryAddress) return [];
      const workItemId =
        event.kind === KIND_GIT_ISSUE || event.kind === KIND_GIT_PULL_REQUEST
          ? event.id
          : linkedRootId(event, input.repositoryAddress);
      if (workItemId && !rootIds.has(workItemId)) return [];
      return [
        {
          id: event.id,
          kind: event.kind,
          author: event.pubkey,
          content: event.content,
          createdAt: event.created_at,
          workItemId: workItemId ?? null,
        } satisfies RepositoryActivity,
      ];
    })
    .sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    );
}

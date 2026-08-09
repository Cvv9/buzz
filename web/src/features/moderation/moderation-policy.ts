export const KIND_REPORT = 1984;
export const KIND_MODERATION_BAN = 9040;
export const KIND_MODERATION_UNBAN = 9041;
export const KIND_MODERATION_TIMEOUT = 9042;
export const KIND_MODERATION_UNTIMEOUT = 9043;
export const KIND_MODERATION_RESOLVE_REPORT = 9044;

export type ReportType =
  | "illegal"
  | "nudity"
  | "malware"
  | "spam"
  | "impersonation"
  | "profanity"
  | "other";
export type ResolutionStatus = "resolved" | "dismissed";
export type ResolutionAction =
  | "delete"
  | "kick"
  | "ban"
  | "timeout"
  | "dismiss"
  | "escalate";

const reportTypes = new Set<ReportType>([
  "illegal",
  "nudity",
  "malware",
  "spam",
  "impersonation",
  "profanity",
  "other",
]);
const resolutionActions = new Set<ResolutionAction>([
  "delete",
  "kick",
  "ban",
  "timeout",
  "dismiss",
  "escalate",
]);

export function normalizeHex(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized))
    throw new Error(`${label} must be a 64-character hex value.`);
  return normalized;
}

function optionalReason(reason?: string) {
  const normalized = reason?.trim() ?? "";
  if (new TextEncoder().encode(normalized).byteLength > 512)
    throw new Error("Reason cannot exceed 512 bytes.");
  return normalized ? [["reason", normalized]] : [];
}

/** Reports are global moderation events: intentionally no channel `h` tag. */
export function reportTemplate(input: {
  authorPubkey: string;
  eventId: string;
  reportType: ReportType;
  note?: string;
}) {
  if (!reportTypes.has(input.reportType))
    throw new Error("Unsupported report type.");
  const note = input.note?.trim() ?? "";
  if (new TextEncoder().encode(note).byteLength > 8 * 1024)
    throw new Error("Report note cannot exceed 8 KiB.");
  return {
    kind: KIND_REPORT,
    content: note,
    tags: [
      ["p", normalizeHex(input.authorPubkey, "Reported author")],
      ["e", normalizeHex(input.eventId, "Reported event"), input.reportType],
    ],
  };
}

export function moderationTemplate(
  input:
    | { action: "ban"; pubkey: string; expiresAt?: number; reason?: string }
    | { action: "unban"; pubkey: string }
    | { action: "timeout"; pubkey: string; expiresAt: number; reason?: string }
    | { action: "untimeout"; pubkey: string }
    | {
        action: "resolve";
        reportEventId: string;
        status: ResolutionStatus;
        resolution: ResolutionAction;
        reason?: string;
      },
) {
  if (input.action === "resolve") {
    if (!resolutionActions.has(input.resolution))
      throw new Error("Unsupported resolution action.");
    if ((input.status === "dismissed") !== (input.resolution === "dismiss")) {
      throw new Error(
        "Dismissed reports require dismiss; resolved reports require an enforcement action.",
      );
    }
    return {
      kind: KIND_MODERATION_RESOLVE_REPORT,
      content: "",
      tags: [
        ["report", normalizeHex(input.reportEventId, "Report event")],
        ["status", input.status],
        ["action", input.resolution],
        ...optionalReason(input.reason),
      ],
    };
  }
  const pubkey = normalizeHex(input.pubkey, "Member pubkey");
  if (input.action === "unban")
    return { kind: KIND_MODERATION_UNBAN, content: "", tags: [["p", pubkey]] };
  if (input.action === "untimeout")
    return {
      kind: KIND_MODERATION_UNTIMEOUT,
      content: "",
      tags: [["p", pubkey]],
    };
  const expiresAt = input.expiresAt;
  if (
    expiresAt !== undefined &&
    (!Number.isInteger(expiresAt) || expiresAt <= 0)
  )
    throw new Error("Expiration must be a positive Unix timestamp.");
  if (input.action === "timeout" && expiresAt === undefined)
    throw new Error("Timeout requires an expiration.");
  return {
    kind:
      input.action === "ban" ? KIND_MODERATION_BAN : KIND_MODERATION_TIMEOUT,
    content: "",
    tags: [
      ["p", pubkey],
      ...(expiresAt === undefined ? [] : [["expiration", String(expiresAt)]]),
      ...optionalReason(input.reason),
    ],
  };
}

export function isModeratorRole(role: string | undefined) {
  return role === "owner" || role === "admin";
}

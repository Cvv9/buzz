import { publishEvent } from "@/shared/lib/nostr-client";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import {
  moderationTemplate,
  reportTemplate,
  type ReportType,
} from "./moderation-policy";

const NIP98_KIND = 27235;

export type ModerationReport = {
  id: string;
  reportEventId: string;
  reporterPubkey: string;
  targetKind: "event" | "pubkey" | "blob";
  target: string;
  channelId: string | null;
  reportType: string;
  note: string | null;
  status: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  actionId: string | null;
  createdAt: string;
};
export type ModerationAction = {
  id: string;
  actorPubkey: string;
  action: string;
  targetPubkey: string | null;
  targetEventId: string | null;
  channelId: string | null;
  reasonCode: string | null;
  publicReason: string | null;
  privateReason: string | null;
  matchedPrincipal: string | null;
  createdAt: string;
};
export type CommunityRestriction = {
  pubkey: string;
  banned: boolean;
  banExpiresAt: string | null;
  banReason: string | null;
  mutedUntil: string | null;
  muteReason: string | null;
  actorPubkey: string;
  updatedAt: string;
};

async function nip98Header(url: string) {
  const event = await signNostrEvent(
    {
      kind: NIP98_KIND,
      content: "",
      tags: [
        ["u", url],
        ["method", "GET"],
        ["nonce", crypto.randomUUID()],
      ],
    },
    { requireNip07: true },
  );
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

async function moderationGet<T>(path: string): Promise<T> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: await nip98Header(url) },
  });
  if (!response.ok)
    throw new Error(`Moderation request failed (${response.status}).`);
  return (await response.json()) as T;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function string(value: unknown) {
  return typeof value === "string" ? value : null;
}
function nullableString(value: unknown) {
  return value === null || typeof value === "string" ? value : null;
}

function parseReport(value: unknown): ModerationReport | null {
  const row = asObject(value);
  if (!row) return null;
  const id = string(row.id);
  const reportEventId = string(row.report_event_id);
  const reporterPubkey = string(row.reporter_pubkey);
  const targetKind = string(row.target_kind);
  const target = string(row.target);
  const reportType = string(row.report_type);
  const status = string(row.status);
  const createdAt = string(row.created_at);
  if (
    !id ||
    !reportEventId ||
    !reporterPubkey ||
    !target ||
    !reportType ||
    !status ||
    !createdAt ||
    (targetKind !== "event" && targetKind !== "pubkey" && targetKind !== "blob")
  )
    return null;
  return {
    id,
    reportEventId,
    reporterPubkey,
    targetKind,
    target,
    reportType,
    status,
    createdAt,
    channelId: nullableString(row.channel_id),
    note: nullableString(row.note),
    resolvedBy: nullableString(row.resolved_by),
    resolvedAt: nullableString(row.resolved_at),
    actionId: nullableString(row.action_id),
  };
}
function parseAction(value: unknown): ModerationAction | null {
  const row = asObject(value);
  if (!row) return null;
  const id = string(row.id);
  const actorPubkey = string(row.actor_pubkey);
  const action = string(row.action);
  const createdAt = string(row.created_at);
  if (!id || !actorPubkey || !action || !createdAt) return null;
  return {
    id,
    actorPubkey,
    action,
    createdAt,
    targetPubkey: nullableString(row.target_pubkey),
    targetEventId: nullableString(row.target_event_id),
    channelId: nullableString(row.channel_id),
    reasonCode: nullableString(row.reason_code),
    publicReason: nullableString(row.public_reason),
    privateReason: nullableString(row.private_reason),
    matchedPrincipal: nullableString(row.matched_principal),
  };
}
function parseRestriction(value: unknown): CommunityRestriction | null {
  const row = asObject(value);
  if (!row) return null;
  const pubkey = string(row.pubkey);
  const banned = row.banned;
  const actorPubkey = string(row.actor_pubkey);
  const updatedAt = string(row.updated_at);
  if (!pubkey || typeof banned !== "boolean" || !actorPubkey || !updatedAt)
    return null;
  return {
    pubkey,
    banned,
    actorPubkey,
    updatedAt,
    banExpiresAt: nullableString(row.ban_expires_at),
    banReason: nullableString(row.ban_reason),
    mutedUntil: nullableString(row.muted_until),
    muteReason: nullableString(row.mute_reason),
  };
}

export async function listModerationReports(status = "open") {
  const rows = await moderationGet<unknown[]>(
    `/moderation/reports?limit=100&status=${encodeURIComponent(status)}`,
  );
  return rows
    .map(parseReport)
    .filter((row): row is ModerationReport => row !== null);
}
export async function listModerationAudit() {
  const rows = await moderationGet<unknown[]>("/moderation/audit?limit=100");
  return rows
    .map(parseAction)
    .filter((row): row is ModerationAction => row !== null);
}
export async function listCommunityRestrictions() {
  const rows = await moderationGet<unknown[]>("/moderation/restricted");
  return rows
    .map(parseRestriction)
    .filter((row): row is CommunityRestriction => row !== null);
}
export function submitReport(input: {
  authorPubkey: string;
  eventId: string;
  reportType: ReportType;
  note?: string;
}) {
  return publishEvent(relayWsUrl(), reportTemplate(input));
}
export function submitModeration(
  input: Parameters<typeof moderationTemplate>[0],
) {
  return publishEvent(relayWsUrl(), moderationTemplate(input));
}

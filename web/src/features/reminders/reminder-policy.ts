export type ReminderStatus = "pending" | "done" | "cancelled";
export type ReminderTarget = {
  eventId: string;
  channelId: string;
  preview: string;
  authorPubkey: string;
};
export type ReminderContent = {
  status: ReminderStatus;
  note?: string;
  target?: ReminderTarget;
};

const PUBKEY_RE = /^[0-9a-f]{64}$/i;
const EVENT_ID_RE = /^[0-9a-f]{64}$/i;
const CHANNEL_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function replaceControlCharacters(value: string) {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : character;
    })
    .join("");
}

/** Normalize a message target before it becomes encrypted reminder content. */
export function normalizeReminderTarget(
  target: ReminderTarget,
): ReminderTarget | null {
  const eventId = target.eventId.trim().toLowerCase();
  const channelId = target.channelId.trim().toLowerCase();
  const authorPubkey = target.authorPubkey.trim().toLowerCase();
  const preview = replaceControlCharacters(target.preview).trim();
  if (
    !EVENT_ID_RE.test(eventId) ||
    !CHANNEL_ID_RE.test(channelId) ||
    !PUBKEY_RE.test(authorPubkey) ||
    !preview
  ) {
    return null;
  }
  return {
    eventId,
    channelId,
    authorPubkey,
    preview: preview.slice(0, 280),
  };
}

export function parseNotBefore(value: string): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseTarget(value: unknown): ReminderTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if (
    typeof target.eventId !== "string" ||
    typeof target.channelId !== "string" ||
    typeof target.preview !== "string" ||
    typeof target.authorPubkey !== "string"
  ) {
    return null;
  }
  return normalizeReminderTarget({
    eventId: target.eventId,
    channelId: target.channelId,
    preview: target.preview,
    authorPubkey: target.authorPubkey,
  });
}

export function parseReminderContent(
  plaintext: string,
): ReminderContent | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const value = parsed as Record<string, unknown>;
    if (
      value.status !== "pending" &&
      value.status !== "done" &&
      value.status !== "cancelled"
    ) {
      return null;
    }
    if (value.note !== undefined && typeof value.note !== "string") return null;
    const target =
      value.target === undefined ? undefined : parseTarget(value.target);
    if (value.target !== undefined && !target) return null;
    if (!target && (!value.note || value.note.trim().length === 0)) return null;
    return {
      status: value.status,
      note: value.note,
      target: target ?? undefined,
    };
  } catch {
    return null;
  }
}

export function hasNavigableReminderTarget(target: ReminderTarget | undefined) {
  return Boolean(target && normalizeReminderTarget(target));
}

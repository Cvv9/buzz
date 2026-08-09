import * as React from "react";
import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";
import { getUnlockedBrowserIdentity } from "@/shared/lib/browser-identity";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  parseNotBefore,
  parseReminderContent,
  normalizeReminderTarget,
  type ReminderContent,
  type ReminderTarget,
} from "./reminder-policy";

export {
  hasNavigableReminderTarget,
  normalizeReminderTarget,
  parseNotBefore,
  parseReminderContent,
} from "./reminder-policy";
export type { ReminderContent, ReminderTarget } from "./reminder-policy";
export const KIND_EVENT_REMINDER = 30300;
export type Reminder = {
  id: string;
  eventId: string;
  createdAt: number;
  notBefore?: number;
  content: ReminderContent;
};

const REMINDER_ID_RE = /^[0-9a-f]{32}$/i;

function oneTag(event: NostrEvent, name: string) {
  const tags = event.tags.filter(
    (tag): tag is [string, string, ...string[]] =>
      tag[0] === name && typeof tag[1] === "string",
  );
  return tags.length === 1 ? tags[0][1] : null;
}

async function decryptReminder(
  event: NostrEvent,
  authorPubkey: string,
): Promise<Reminder | null> {
  if (
    event.kind !== KIND_EVENT_REMINDER ||
    event.pubkey.toLowerCase() !== authorPubkey
  ) {
    return null;
  }
  const id = oneTag(event, "d");
  if (!id || !REMINDER_ID_RE.test(id)) return null;
  const rawNotBefore = event.tags.filter((tag) => tag[0] === "not_before");
  if (rawNotBefore.length > 1) return null;
  const notBefore =
    rawNotBefore.length === 1
      ? parseNotBefore(rawNotBefore[0]?.[1] ?? "")
      : undefined;
  if (rawNotBefore.length === 1 && notBefore === undefined) return null;
  try {
    const content = parseReminderContent(
      await nip44DecryptFromSelf(authorPubkey, event.content),
    );
    if (
      !content ||
      (content.status === "pending") !== (notBefore !== undefined)
    ) {
      return null;
    }
    return {
      id: id.toLowerCase(),
      eventId: event.id,
      createdAt: event.created_at,
      notBefore,
      content,
    };
  } catch {
    return null;
  }
}

function latestByCoordinate(events: NostrEvent[]) {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const id = oneTag(event, "d")?.toLowerCase();
    if (!id || !REMINDER_ID_RE.test(id)) continue;
    const current = latest.get(id);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      latest.set(id, event);
    }
  }
  return latest;
}

export async function fetchReminders(authorPubkey: string) {
  const author = authorPubkey.toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(author)) return [];
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_EVENT_REMINDER],
    authors: [author],
    limit: 200,
  });
  const decrypted = await Promise.all(
    [...latestByCoordinate(events).values()].map((event) =>
      decryptReminder(event, author),
    ),
  );
  return decrypted.filter(
    (reminder): reminder is Reminder => reminder !== null,
  );
}

function randomReminderId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function expiration() {
  return (
    Math.floor(Date.now() / 1_000) +
    (30 + Math.floor(Math.random() * 60)) * 86_400
  );
}

async function publishReminder(
  id: string,
  content: ReminderContent,
  tags: string[][],
  createdAt?: number,
) {
  return publishEvent(relayWsUrl(), {
    kind: KIND_EVENT_REMINDER,
    content: await nip44EncryptToSelf(
      getUnlockedBrowserIdentity()?.pubkey ?? "",
      JSON.stringify(content),
    ),
    tags: [["d", id], ...tags],
    ...(createdAt ? { created_at: createdAt } : {}),
  });
}

export async function createReminder(note: string, notBefore: number) {
  const normalized = note.trim();
  if (!normalized) throw new Error("Write a reminder note first.");
  if (!Number.isSafeInteger(notBefore) || notBefore <= 0) {
    throw new Error("Choose a valid reminder time.");
  }
  return publishReminder(
    randomReminderId(),
    { status: "pending", note: normalized },
    [["not_before", String(notBefore)]],
  );
}

/** Create an encrypted, author-only reminder that safely points at one message. */
export async function createMessageReminder(
  target: ReminderTarget,
  notBefore: number,
) {
  const normalizedTarget = normalizeReminderTarget(target);
  if (!normalizedTarget)
    throw new Error("This message cannot be used as a reminder.");
  if (!Number.isSafeInteger(notBefore) || notBefore <= 0) {
    throw new Error("Choose a valid reminder time.");
  }
  return publishReminder(
    randomReminderId(),
    { status: "pending", target: normalizedTarget },
    [["not_before", String(notBefore)]],
  );
}

export function snoozeReminder(reminder: Reminder, notBefore: number) {
  if (!Number.isSafeInteger(notBefore) || notBefore <= 0) {
    throw new Error("Choose a valid reminder time.");
  }
  return publishReminder(
    reminder.id,
    { ...reminder.content, status: "pending" },
    [["not_before", String(notBefore)]],
    Math.max(Math.floor(Date.now() / 1_000), reminder.createdAt + 1),
  );
}

function closeReminder(reminder: Reminder, status: "done" | "cancelled") {
  return publishReminder(
    reminder.id,
    { ...reminder.content, status },
    [["expiration", String(expiration())]],
    Math.max(Math.floor(Date.now() / 1_000), reminder.createdAt + 1),
  );
}

export const completeReminder = (reminder: Reminder) =>
  closeReminder(reminder, "done");
export const cancelReminder = (reminder: Reminder) =>
  closeReminder(reminder, "cancelled");

/** Author-only durable state. A live replacement atomically replaces a head. */
export function useReminders(authorPubkey?: string) {
  const author = authorPubkey?.toLowerCase() ?? "";
  const [reminders, setReminders] = React.useState<Reminder[]>([]);
  const [loading, setLoading] = React.useState(Boolean(author));

  React.useEffect(() => {
    setReminders([]);
    setLoading(Boolean(author));
    if (!/^[0-9a-f]{64}$/i.test(author)) return;
    let cancelled = false;
    const refresh = () =>
      void fetchReminders(author)
        .then((next) => {
          if (!cancelled) setReminders(next);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    refresh();
    const stop = subscribeEvents(
      relayWsUrl(),
      { kinds: [KIND_EVENT_REMINDER], authors: [author] },
      () => refresh(),
      (status) => {
        if (status === "live") refresh();
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [author]);

  return {
    reminders,
    loading,
    refresh: () => fetchReminders(author).then(setReminders),
  };
}

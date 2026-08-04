export const APPROVAL_REQUEST_KIND: 46010;
export const INBOX_DISMISS_CONTEXT_PREFIX: "inbox-dismiss:";

export function isTargetedApprovalRequest(
  event: { kind: number; tags: string[][] },
  pubkey: string,
): boolean;

export function inboxDismissContextId(eventId: string): string;

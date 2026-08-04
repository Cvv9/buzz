export const APPROVAL_REQUEST_KIND = 46010;
export const INBOX_DISMISS_CONTEXT_PREFIX = "inbox-dismiss:";

export function isTargetedApprovalRequest(event, pubkey) {
  const normalizedPubkey = pubkey.toLowerCase();
  return (
    event.kind === APPROVAL_REQUEST_KIND &&
    event.tags.some(
      (tag) => tag[0] === "p" && tag[1]?.toLowerCase() === normalizedPubkey,
    )
  );
}

export function inboxDismissContextId(eventId) {
  return `${INBOX_DISMISS_CONTEXT_PREFIX}${eventId}`;
}

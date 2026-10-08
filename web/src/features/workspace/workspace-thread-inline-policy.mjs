/** Threads up to this many replies render under the root message; longer ones open the panel. */
export const INLINE_THREAD_REPLY_LIMIT = 6;

export function shouldShowThreadInline(replyCount) {
  return (
    Number.isInteger(replyCount) &&
    replyCount > 0 &&
    replyCount <= INLINE_THREAD_REPLY_LIMIT
  );
}

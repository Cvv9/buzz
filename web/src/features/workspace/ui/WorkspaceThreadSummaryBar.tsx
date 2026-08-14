import { relativeTime } from "@/shared/lib/relative-time";
import type { WorkspaceProfile } from "../workspace-api";
import { ProfileAvatar } from "./WorkspaceSidebar";

type WorkspaceThreadSummaryBarProps = {
  messageId: string;
  replierProfiles: WorkspaceProfile[];
  replyCount: number;
  lastReplyAt: number | null;
  onOpen: () => void;
};

/**
 * Slack-style collapsed thread affordance shown under a root message: an
 * overlapping avatar cluster of up to three distinct repliers, the reply count,
 * and the last reply's relative time. Clicking opens the focused thread panel —
 * replies are never expanded inline in the timeline.
 */
export function WorkspaceThreadSummaryBar({
  messageId,
  replierProfiles,
  replyCount,
  lastReplyAt,
  onOpen,
}: WorkspaceThreadSummaryBarProps) {
  return (
    <button
      className="group/thread mb-2 ml-10 flex w-fit items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-left transition-colors hover:bg-black/5 sm:ml-14 dark:hover:bg-white/5"
      data-testid={`thread-summary-${messageId}`}
      type="button"
      onClick={onOpen}
    >
      {replierProfiles.length ? (
        <div className="flex items-center">
          {replierProfiles.map((profile, index) => (
            <div
              className={
                index === 0
                  ? "rounded-xl ring-2 ring-[#f8f9f4] dark:ring-[#171916]"
                  : "-ml-2 rounded-xl ring-2 ring-[#f8f9f4] dark:ring-[#171916]"
              }
              key={profile.pubkey}
            >
              <ProfileAvatar profile={profile} size="sm" />
            </div>
          ))}
        </div>
      ) : null}
      <span className="text-xs font-semibold text-[#777800] dark:text-[#d7d72e]">
        {replyCount} {replyCount === 1 ? "reply" : "replies"}
      </span>
      {lastReplyAt !== null ? (
        <span className="text-xs text-black/40 dark:text-white/35">
          {relativeTime(lastReplyAt)}
        </span>
      ) : null}
      <span className="hidden text-xs text-black/40 group-hover/thread:inline dark:text-white/35">
        View thread
      </span>
    </button>
  );
}

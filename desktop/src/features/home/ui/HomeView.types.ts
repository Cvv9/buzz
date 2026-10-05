import type { InboxFilter } from "@/features/home/lib/inbox";
import type { HomeFeedResponse } from "@/shared/api/types";

export type HomeViewProps = {
  feed?: HomeFeedResponse;
  isLoading?: boolean;
  errorMessage?: string;
  currentPubkey?: string;
  availableChannelIds: ReadonlySet<string>;
  onOpenContext: (
    channelId: string,
    messageId: string,
    threadRootId?: string | null,
  ) => void;
  onRefresh: () => void;
  initialFilter?: InboxFilter;
};

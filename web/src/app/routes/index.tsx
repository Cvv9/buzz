import { createFileRoute } from "@tanstack/react-router";
import { WorkspacePage } from "@/features/workspace/ui/WorkspacePage";

type WorkspaceSearch = {
  channel?: string;
  thread?: string;
  forum?: string;
};

function optionalSearchValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (search): WorkspaceSearch => ({
    channel: optionalSearchValue(search.channel),
    thread: optionalSearchValue(search.thread),
    forum: optionalSearchValue(search.forum),
  }),
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const search = Route.useSearch();
  return (
    <WorkspacePage
      channelPermalink={search.channel}
      threadPermalink={search.thread}
    />
  );
}

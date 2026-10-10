import { Archive, MoreHorizontal } from "lucide-react";

/** Account-only archive action; message history and other participants are retained. */
export function ConversationActions({
  name,
  pending,
  onArchive,
}: {
  name: string;
  pending: boolean;
  onArchive: () => void;
}) {
  return (
    <details
      className="relative mr-1 shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={`Conversation actions for ${name}`}
        className="cursor-pointer list-none rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </summary>
      <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
        <button
          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={pending}
          type="button"
          onClick={(event) => {
            const disclosure = event.currentTarget.closest("details");
            if (disclosure) disclosure.open = false;
            onArchive();
          }}
        >
          <Archive aria-hidden="true" className="size-4" />
          {pending ? "Archiving…" : "Archive for me"}
        </button>
      </div>
    </details>
  );
}

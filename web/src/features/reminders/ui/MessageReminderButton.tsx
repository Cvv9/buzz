import { BellPlus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  normalizeReminderTarget,
  type ReminderTarget,
} from "../reminder-policy";
import { createMessageReminder } from "../reminder-service";

/** One-click, encrypted reminder creation for a valid channel message. */
export function MessageReminderButton({ target }: { target: ReminderTarget }) {
  const normalizedTarget = normalizeReminderTarget(target);
  const [pending, setPending] = React.useState(false);
  if (!normalizedTarget) return null;
  return (
    <button
      aria-label="Remind me about this message in one hour"
      className="px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      disabled={pending}
      type="button"
      onClick={() => {
        setPending(true);
        void createMessageReminder(
          normalizedTarget,
          Math.floor(Date.now() / 1_000) + 3_600,
        )
          .then(() => {
            toast.success("Reminder set for one hour from now.");
          })
          .catch((error) => {
            toast.error("Reminder could not be created", {
              description: error instanceof Error ? error.message : undefined,
            });
          })
          .finally(() => setPending(false));
      }}
    >
      <BellPlus className="mr-1 inline size-3.5" /> Remind
    </button>
  );
}

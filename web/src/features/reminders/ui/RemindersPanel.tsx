import { ArrowLeft, Bell, Check, Clock3, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/shared/ui/button";
import {
  cancelReminder,
  completeReminder,
  createReminder,
  hasNavigableReminderTarget,
  type Reminder,
  snoozeReminder,
  useReminders,
} from "../reminder-service";

function formatWhen(timestamp: number | undefined) {
  return timestamp
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(timestamp * 1_000)
    : "No longer scheduled";
}

function initialSchedule() {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setSeconds(0, 0);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 16);
}

function ReminderRow({
  reminder,
  onChanged,
  onOpenTarget,
}: {
  reminder: Reminder;
  onChanged: () => void;
  onOpenTarget: (reminder: Reminder) => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (operation: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await operation();
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update this reminder.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <li className="border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex gap-3">
        <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {reminder.content.note ?? "Message reminder"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatWhen(reminder.notBefore)}
          </p>
          {error ? (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          ) : null}
          {reminder.content.status === "pending" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    snoozeReminder(
                      reminder,
                      Math.floor(Date.now() / 1_000) + 3_600,
                    ),
                  )
                }
              >
                <Clock3 /> Snooze 1h
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => completeReminder(reminder))}
              >
                <Check /> Done
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => cancelReminder(reminder))}
              >
                <X /> Cancel
              </Button>
              {hasNavigableReminderTarget(reminder.content.target) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => onOpenTarget(reminder)}
                >
                  Open message
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function RemindersPanel({
  pubkey,
  onBack,
  onOpenTarget,
}: {
  pubkey: string;
  onBack: () => void;
  onOpenTarget: (reminder: Reminder) => void;
}) {
  const { reminders, loading, refresh } = useReminders(pubkey);
  const [note, setNote] = React.useState("");
  const [when, setWhen] = React.useState(initialSchedule);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = reminders
    .filter((reminder) => reminder.content.status === "pending")
    .sort(
      (left, right) =>
        (left.notBefore ?? Infinity) - (right.notBefore ?? Infinity),
    );
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const timestamp = Math.floor(new Date(when).getTime() / 1_000);
    setCreating(true);
    setError(null);
    try {
      await createReminder(note, timestamp);
      setNote("");
      setWhen(initialSchedule());
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the reminder.",
      );
    } finally {
      setCreating(false);
    }
  };
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="reminders-page"
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        <Button
          aria-label="Back to workspace"
          size="icon"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-sm font-semibold">Reminders</h1>
          <p className="text-xs text-muted-foreground">
            Encrypted to your account
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <form className="max-w-xl space-y-3" onSubmit={create}>
          <label className="block text-sm font-medium" htmlFor="reminder-note">
            Remind me
          </label>
          <textarea
            className="block min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            id="reminder-note"
            placeholder="Follow up with the design team"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <label className="block text-sm font-medium" htmlFor="reminder-when">
            When
          </label>
          <input
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            id="reminder-when"
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button disabled={creating || !note.trim()} type="submit">
            {creating ? "Creating…" : "Create reminder"}
          </Button>
        </form>
        <div className="mt-8 max-w-xl overflow-hidden rounded-lg border border-border">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Loading reminders…
            </p>
          ) : pending.length ? (
            <ul>
              {pending.map((reminder) => (
                <ReminderRow
                  key={reminder.id}
                  reminder={reminder}
                  onChanged={() => void refresh()}
                  onOpenTarget={onOpenTarget}
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              No pending reminders. Add one above to keep a thought close.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

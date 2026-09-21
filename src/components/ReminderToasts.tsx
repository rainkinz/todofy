import { useStore } from "../store";
import { BellIcon, CloseIcon } from "./Icons";

export function ReminderToasts() {
  const { reminders, dismissReminder, select, snoozeTask } = useStore();
  if (reminders.length === 0) return null;

  return (
    <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {reminders.map((r) => (
        <div
          key={r.id}
          class="pointer-events-auto flex w-80 animate-slide-left items-start gap-3 rounded-xl border border-border-strong bg-elevated p-3 shadow-lg shadow-black/30"
        >
          <span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-(--color-accent)">
            <BellIcon width={16} height={16} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-medium uppercase tracking-wider text-faint">
              Reminder
            </p>
            <p class="truncate text-sm text-text">{r.title}</p>
            <div class="mt-2 flex gap-2">
              <button
                onClick={() => {
                  select(r.id);
                  dismissReminder(r.id);
                }}
                class="rounded-md bg-(--color-accent) px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Open
              </button>
              <button
                onClick={() => {
                  // Not an answer: snoozing re-arms the reminder, and the
                  // backend clears the acknowledgement as part of that.
                  snoozeTask(r.id, 10);
                  dismissReminder(r.id, false);
                }}
                class="rounded-md bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-text"
              >
                Snooze 10m
              </button>
            </div>
          </div>
          <button
            onClick={() => dismissReminder(r.id)}
            class="text-faint hover:text-text"
            title="Dismiss"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

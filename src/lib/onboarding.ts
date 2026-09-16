import { create } from "zustand";
import { api } from "./api";
import { combineDateTime, today } from "./dates";
import { parseQuickAdd } from "./nlp";
import { useStore } from "../store";
import type { NewTask } from "../types";

/**
 * Bumped when the tour changes enough to be worth showing again. The stored
 * value is the version a user last completed, so a future release can compare
 * it and show only what's new instead of the whole flow.
 */
export const ONBOARDING_VERSION = 1;
const KEY = "onboarding_version";

export const ONBOARDING_STEPS = 7;

/** How long the closing curtain runs; kept in step with `onb-curtain-out`. */
const CURTAIN_MS = 340;

interface OnboardingState {
  open: boolean;
  /** True while the curtain animates away, so the app is already interactive. */
  leaving: boolean;
  step: number;
  /** Travel direction of the last move, so slides enter from the right side. */
  dir: 1 | -1;
  /**
   * What the user typed on the capture slide. Held as raw text so stepping
   * back to that slide can restore the sentence, not just its parse.
   */
  draftText: string;

  start: () => void;
  next: () => void;
  back: () => void;
  goTo: (step: number) => void;
  setDraftText: (text: string) => void;
  finish: (options?: { skipped?: boolean }) => Promise<void>;
}

export const useOnboarding = create<OnboardingState>((set, get) => ({
  open: false,
  leaving: false,
  step: 0,
  dir: 1,
  draftText: "",

  start: () =>
    set({ open: true, leaving: false, step: 0, dir: 1, draftText: "" }),

  next: () => {
    const step = get().step;
    if (step >= ONBOARDING_STEPS - 1) {
      void get().finish();
      return;
    }
    set({ step: step + 1, dir: 1 });
  },

  back: () => {
    const step = get().step;
    if (step === 0) return;
    set({ step: step - 1, dir: -1 });
  },

  goTo: (step) => {
    const current = get().step;
    if (step === current || step < 0 || step >= ONBOARDING_STEPS) return;
    set({ step, dir: step > current ? 1 : -1 });
  },

  setDraftText: (draftText) => set({ draftText }),

  finish: async ({ skipped = false } = {}) => {
    if (get().leaving) return;
    set({ leaving: true });

    const draft = firstTaskFrom(get().draftText);
    if (draft) {
      // A first-run list with something already in it beats an empty one.
      await useStore.getState().addTask(draft).catch(() => {});
    }
    api.setSetting(KEY, String(ONBOARDING_VERSION)).catch(() => {});

    // The same confetti a completed task gets — the tour counts as one.
    if (!skipped && draft && useStore.getState().celebrate) {
      useStore.setState({ celebrationAt: Date.now() });
    }

    setTimeout(
      () => set({ open: false, leaving: false, step: 0, draftText: "" }),
      CURTAIN_MS,
    );
  },
}));

/**
 * Turn the sentence typed on the capture slide into a task, following the
 * same rules as the quick-add composer: parsed tokens win, and a time or a
 * recurrence needs a date to anchor to.
 */
export function firstTaskFrom(text: string): NewTask | null {
  if (!text.trim()) return null;
  const parsed = parseQuickAdd(text, useStore.getState().labels);
  const title = parsed.title.trim();
  if (!title) return null;

  const dueDate = parsed.dueDate || (parsed.time || parsed.repeat ? today() : "");
  const task: NewTask = { title, priority: parsed.priority ?? 4 };
  if (dueDate) task.dueDate = dueDate;
  if (dueDate && parsed.time) task.remindAt = combineDateTime(dueDate, parsed.time);
  if (parsed.repeat) task.repeat = parsed.repeat;
  if (parsed.labelIds.length) task.labelIds = parsed.labelIds;
  return task;
}

/**
 * Decide whether to run the first-run tour. Call this once the store has
 * loaded: an install that already holds data belongs to someone who has been
 * using todofy since before the tour existed, and they get marked as done
 * rather than walked through an introduction to their own app.
 */
export async function initOnboarding(): Promise<void> {
  let seen: string | null;
  try {
    seen = await api.getSetting(KEY);
  } catch {
    // Without a readable setting there's no way to avoid showing this twice.
    return;
  }
  if (seen !== null) return;

  const { tasks, labels, journal } = useStore.getState();
  if (tasks.length > 0 || labels.length > 0 || journal.length > 0) {
    api.setSetting(KEY, String(ONBOARDING_VERSION)).catch(() => {});
    return;
  }

  useOnboarding.getState().start();
}

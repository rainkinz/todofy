import type { Task } from "../types";
import { toLocalDate, today } from "./dates";

/**
 * Stages are slugs on the task rather than rows in a table, so custom names,
 * colors and WIP limits can be layered on later as a lookup without migrating
 * a single task. A null `stage` belongs in the first column.
 */
export const STAGES = [
  { slug: "todo", title: "To do", hint: "Ready to pick up" },
  { slug: "doing", title: "In progress", hint: "Being worked on now" },
  { slug: "blocked", title: "Blocked", hint: "Waiting on something else" },
] as const;

export type StageSlug = (typeof STAGES)[number]["slug"];

/**
 * Derived from `status`, not stored as a stage. Drops here go through
 * `toggleTask` so a recurring task rolls forward instead of parking.
 */
export const DONE_COLUMN = "done";

export type ColumnId = StageSlug | typeof DONE_COLUMN;

export type BoardScope = "all" | "today" | "week";

export const SCOPES: { id: BoardScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
];

const SCOPE_KEY = "todofy-board-scope";

/** Read outside the view too, so keyboard nav walks exactly what's on screen. */
export function readBoardScope(): BoardScope {
  const stored = localStorage.getItem(SCOPE_KEY);
  return SCOPES.some((s) => s.id === stored) ? (stored as BoardScope) : "all";
}

export function writeBoardScope(scope: BoardScope): void {
  localStorage.setItem(SCOPE_KEY, scope);
}

export interface BoardColumn {
  id: ColumnId;
  title: string;
  hint: string;
  tasks: Task[];
}

/** The columns left to right, as the board lays them out. */
export const COLUMN_ORDER: ColumnId[] = [
  ...STAGES.map((s) => s.slug),
  DONE_COLUMN,
];

/** Which column a task renders in. Completed always wins over its stage. */
export function columnOf(task: Task): ColumnId {
  if (task.status === "done") return DONE_COLUMN;
  const stage = STAGES.find((s) => s.slug === task.stage);
  return stage ? stage.slug : STAGES[0].slug;
}

/**
 * Narrow the board to a time window. Undated tasks stay visible in every scope
 * — hiding them would make the board quietly lose work.
 */
export function inScope(task: Task, scope: BoardScope): boolean {
  if (scope === "all" || !task.dueDate) return true;
  const t = today();
  if (scope === "today") return task.dueDate <= t;
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 7);
  return task.dueDate <= toLocalDate(horizon);
}

/**
 * Group tasks into columns, each sorted by manual order. Done is capped
 * because it grows without limit; the full history has its own view.
 */
export function boardColumns(tasks: Task[], doneLimit = 15): BoardColumn[] {
  const byColumn = new Map<ColumnId, Task[]>();
  for (const task of tasks) {
    const id = columnOf(task);
    const list = byColumn.get(id) ?? [];
    list.push(task);
    byColumn.set(id, list);
  }

  const columns: BoardColumn[] = STAGES.map(({ slug, title, hint }) => ({
    id: slug,
    title,
    hint,
    tasks: (byColumn.get(slug) ?? []).sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        a.boardIndex - b.boardIndex ||
        a.createdAt.localeCompare(b.createdAt),
    ),
  }));

  const done = (byColumn.get(DONE_COLUMN) ?? [])
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, doneLimit);

  return [
    ...columns,
    { id: DONE_COLUMN, title: "Done", hint: "Finished recently", tasks: done },
  ];
}

/**
 * Where a task lands if nudged one column left or right — the keyboard's
 * equivalent of a drag, null at either end. The card joins the bottom of its
 * new column, so the move needs no second "which slot?" decision.
 */
export function nudgeColumn(
  task: Task,
  tasks: Task[],
  direction: 1 | -1,
): { column: ColumnId; boardIndex: number } | null {
  const from = COLUMN_ORDER.indexOf(columnOf(task));
  const to = from + direction;
  if (to < 0 || to >= COLUMN_ORDER.length) return null;

  const column = COLUMN_ORDER[to];
  const last = tasks
    .filter((t) => t.id !== task.id && columnOf(t) === column)
    .reduce((max, t) => Math.max(max, t.boardIndex), Number.NEGATIVE_INFINITY);
  return {
    column,
    boardIndex: last === Number.NEGATIVE_INFINITY ? 0 : last + 1,
  };
}

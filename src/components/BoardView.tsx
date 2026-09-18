import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { applySearchAndFilters, useStore } from "../store";
import {
  boardColumns,
  columnOf,
  DONE_COLUMN,
  inScope,
  readBoardScope,
  SCOPES,
  writeBoardScope,
  type BoardScope,
} from "../lib/board";
import { useBoardDrag } from "../lib/useBoardDrag";
import { formatDue, isPast } from "../lib/dates";
import { formatDuration, formatMinutes } from "../lib/duration";
import { overEstimateBy, trackedElapsed, trackingState } from "../lib/tracking";
import { useTick } from "../lib/useTick";
import { repeatLabel } from "../lib/repeat";
import type { Task } from "../types";
import { SearchBar } from "./SearchBar";
import { TaskDetail } from "./TaskDetail";
import {
  BellIcon,
  CheckCircleIcon,
  CheckIcon,
  CloseIcon,
  FlagIcon,
  HourglassIcon,
  RepeatIcon,
  TimerIcon,
} from "./Icons";

const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--color-prio-1)",
  2: "var(--color-prio-2)",
  3: "var(--color-prio-3)",
  4: "var(--color-prio-4)",
};

const DUE_TONE: Record<string, string> = {
  overdue: "is-overdue",
  today: "is-today",
  soon: "is-soon",
  future: "is-future",
};

export function BoardView() {
  const {
    tasks,
    searchQuery,
    filterLabelIds,
    filterPriorities,
    selectedId,
    select,
    moveTaskToColumn,
  } = useStore();
  const [scope, setScopeState] = useState<BoardScope>(readBoardScope);

  const setScope = (next: BoardScope) => {
    setScopeState(next);
    writeBoardScope(next);
  };

  const visible = applySearchAndFilters(
    tasks,
    searchQuery,
    filterLabelIds,
    filterPriorities,
  ).filter((task) => inScope(task, scope));
  const columns = boardColumns(visible);

  const { dragId, over, setCardRef, setColumnRef, setScrollerRef, startDrag } =
    useBoardDrag(columns, moveTaskToColumn);

  const selected = selectedId
    ? visible.find((task) => task.id === selectedId)
    : undefined;
  const active = visible.filter((task) => task.status !== "done").length;

  return (
    <main class="redesign-main board-page">
      <header class="app-page-header">
        <div>
          <h2>Board</h2>
          <p>Move work across stages</p>
        </div>
        <div class="board-toolbar">
          <div class="board-scope-switch" role="group" aria-label="Board scope">
            {SCOPES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setScope(id)}
                class={scope === id ? "is-active" : ""}
                aria-pressed={scope === id}
              >
                {label}
              </button>
            ))}
          </div>
          <SearchBar />
        </div>
      </header>

      <div class="board-surface">
        <div class="board-columns" ref={setScrollerRef}>
          {columns.map((column) => {
            const target = over?.column === column.id ? over : null;
            // The drop target is an index into the column *without* the card
            // being dragged, but the card keeps its slot on screen (dimmed, as
            // in the list view) — so step the marker past it when it sits above
            // the insertion point.
            const draggedAt = column.tasks.findIndex((t) => t.id === dragId);
            const slot = target
              ? draggedAt !== -1 && target.index >= draggedAt
                ? target.index + 1
                : target.index
              : null;
            return (
              <section
                key={column.id}
                ref={setColumnRef(column.id)}
                class={`board-column ${target ? "is-drop-target" : ""}`}
                aria-label={column.title}
              >
                <header class="board-column-head">
                  <div>
                    <h3>{column.title}</h3>
                    <small>{column.hint}</small>
                  </div>
                  <span class="board-column-count">{column.tasks.length}</span>
                </header>

                <div class="board-column-cards">
                  {column.tasks.length === 0 && !target && (
                    <p class="board-column-empty">
                      {column.id === DONE_COLUMN
                        ? "Nothing finished yet."
                        : "Drop a card here."}
                    </p>
                  )}
                  {column.tasks.map((task, index) => (
                    <>
                      {slot === index && <DropSlot />}
                      <BoardCard
                        key={task.id}
                        task={task}
                        selected={task.id === selectedId}
                        dragging={task.id === dragId}
                        cardRef={setCardRef(task.id)}
                        onPointerDown={startDrag(task.id)}
                        onSelect={() => select(task.id)}
                      />
                    </>
                  ))}
                  {slot !== null && slot >= column.tasks.length && <DropSlot />}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <footer class="board-status">
        <span>
          {active} active card{active === 1 ? "" : "s"}
        </span>
        <span>Drag a card between columns to move it</span>
      </footer>

      {selected && (
        <TaskModal
          title={columnOf(selected) === DONE_COLUMN ? "Completed" : "Task"}
          taskId={selected.id}
          onClose={() => select(null)}
        />
      )}
    </main>
  );
}

/** The gap a dragged card would drop into. */
function DropSlot() {
  return <div class="board-drop-slot" aria-hidden="true" />;
}

/**
 * The full task, opened over the board when a card is clicked. A modal rather
 * than a side panel: the columns need the width, and a panel that shrinks as
 * the window narrows leaves the task unreachable at small sizes.
 *
 * Escape closes it via the global shortcut, which clears the selection.
 */
function TaskModal({
  taskId,
  title,
  onClose,
}: {
  taskId: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      class="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div class="task-modal animate-fade-rise">
        <header class="task-modal-head">
          <p class="section-kicker">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task"
            title="Close"
          >
            <CloseIcon width={15} height={15} />
          </button>
        </header>
        <div class="task-modal-body">
          <TaskDetail taskId={taskId} compact />
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  task: Task;
  selected: boolean;
  dragging: boolean;
  cardRef: (element: HTMLElement | null) => void;
  onPointerDown: (event: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onSelect: () => void;
}

function BoardCard({
  task,
  selected,
  dragging,
  cardRef,
  onPointerDown,
  onSelect,
}: CardProps) {
  const { labels, toggleTask, activeTimer } = useStore();
  const done = task.status === "done";
  const taskLabels = labels.filter((label) => task.labelIds.includes(label.id));
  const lateReminder = !done && isPast(task.remindAt);
  const due = task.dueDate
    ? formatDue(task.dueDate, done ? null : task.remindAt)
    : null;
  const subtaskTotal = task.subtasks.length;
  const subtaskDone = task.subtasks.filter((subtask) => subtask.done).length;
  const tracking = trackingState(task.id, activeTimer);
  // A paused clock doesn't move, so there's nothing to re-render for.
  useTick(tracking === "running");
  const elapsed = trackedElapsed(task, activeTimer);
  const over = overEstimateBy(task, elapsed);

  return (
    <article
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      class={`board-card ${selected ? "is-selected" : ""} ${done ? "is-done" : ""} ${
        tracking !== "off" ? "is-tracked" : ""
      } ${task.pinned ? "is-pinned" : ""} ${dragging ? "is-dragging" : ""}`}
      style={{ "--card-accent": PRIORITY_COLOR[task.priority] }}
    >
      <div class="board-card-head">
        <button
          type="button"
          class="task-complete"
          style={
            !done ? { borderColor: PRIORITY_COLOR[task.priority] } : undefined
          }
          title={done ? "Mark active" : "Complete"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggleTask(task.id, !done);
          }}
        >
          {done && <CheckIcon width={11} height={11} stroke-width={3} />}
        </button>
        <p class="board-card-title">{task.title}</p>
      </div>

      <div class="board-card-meta">
        {task.priority < 4 && (
          <span style={{ color: PRIORITY_COLOR[task.priority] }}>
            <FlagIcon width={12} height={12} />P{task.priority}
          </span>
        )}
        {due && <span class={DUE_TONE[due.tone]}>{due.label}</span>}
        {task.remindAt && lateReminder && (
          <span class="is-overdue" title="Reminder passed">
            <BellIcon width={12} height={12} />
          </span>
        )}
        {task.repeat && (
          <span title={`Repeats ${repeatLabel(task.repeat).toLowerCase()}`}>
            <RepeatIcon width={12} height={12} />
          </span>
        )}
        {subtaskTotal > 0 && (
          <span title={`${subtaskDone} of ${subtaskTotal} steps done`}>
            <CheckCircleIcon width={12} height={12} />
            {subtaskDone}/{subtaskTotal}
          </span>
        )}
        {task.estimateMinutes !== null && elapsed === 0 && (
          <span title={`Estimated ${formatMinutes(task.estimateMinutes)}`}>
            <HourglassIcon width={12} height={12} />
            {formatMinutes(task.estimateMinutes)}
          </span>
        )}
        {elapsed > 0 && (
          <span
            class={
              over > 0
                ? "is-over"
                : tracking === "running"
                  ? "is-tracking"
                  : tracking === "paused"
                    ? "is-held"
                    : ""
            }
            title={
              over > 0
                ? `${formatDuration(over)} over the ${formatMinutes(task.estimateMinutes ?? 0)} estimate`
                : "Time tracked on this task"
            }
          >
            <TimerIcon width={12} height={12} />
            {formatDuration(elapsed)}
          </span>
        )}
      </div>

      {taskLabels.length > 0 && (
        <div class="board-card-labels">
          {taskLabels.map((label) => (
            <span key={label.id} style={{ color: label.color }}>
              <i style={{ background: label.color }} />
              {label.name}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

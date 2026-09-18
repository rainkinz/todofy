-- Kanban board placement per task.
--
-- `stage` is a slug rather than a foreign key, so named columns can be added
-- later as a lookup without migrating task rows. NULL is the first column.
-- There is no 'done' slug: that column is derived from `status`, so completing
-- a task on the board still runs the recurrence rollover.
--
-- `board_index` is the manual order within a column, separate from
-- `order_index` because the list groups by date and the board by stage.
--
-- Additive and idempotent: older clients never write either column.

alter table public.tasks
  add column if not exists stage text;

alter table public.tasks
  add column if not exists board_index double precision not null default 0;

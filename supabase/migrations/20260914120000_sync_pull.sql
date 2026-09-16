-- Bundles all six sync tables into one request per poll instead of a GET each.
-- `security invoker` so the existing RLS policies still decide which rows the
-- caller sees; the explicit `user_id` predicate is redundant with them but
-- keeps each branch on its `(user_id, updated_at)` index.

create or replace function public.sync_pull(since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'labels', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.labels t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.tasks t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'task_labels', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.task_labels t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.time_sessions t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.journal_entries t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'tombstones', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.sync_tombstones t
      where t.user_id = (select auth.uid()) and t.recorded_at > since
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.sync_pull(timestamptz) from public, anon;
grant execute on function public.sync_pull(timestamptz) to authenticated;

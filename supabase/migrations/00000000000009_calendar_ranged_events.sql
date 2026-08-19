-- Phase 9: Calendar tab — multi-day (ranged) events, created by dragging
-- from one date to another on the calendar (e.g. Jan 1 -> Jan 6).
--
-- Reuses the existing `tasks` table again, same as the Phase 8 one-off
-- calendar tasks:
--
--   due_at    — already exists; used as the RANGE START date (time
--               portion stays at midnight for ranged events).
--   end_date  — new nullable date column. When set, the task is a
--               multi-day event spanning [due_at's date, end_date]
--               inclusive, and is rendered as a spanning bar instead
--               of a single-day chip. When null, behavior is unchanged
--               from Phase 8 (a single-day task/deadline).

alter table public.tasks
  add column if not exists end_date date;

comment on column public.tasks.end_date is
  'Inclusive end date for multi-day calendar events. Null = single-day task (uses due_at only).';

-- Phase 8: Calendar tab — one-off, date-tied tasks with an optional
-- time-of-day and room, created by clicking a date on the calendar.
--
-- Reuses the existing `tasks` table (due_at already ties a task to a
-- date) rather than introducing a new table. Two new nullable columns:
--
--   room      — optional location string, e.g. "Rm 214"
--   due_time  — optional raw "HH:MM" (24h) time-of-day. due_at still
--               carries the combined date+time (or midnight when no
--               time is given) so existing sorting/streak logic keeps
--               working unchanged; due_time is only for knowing
--               whether a specific time was set, for display.

alter table public.tasks
  add column if not exists room text,
  add column if not exists due_time text;

-- Phase 6: Notifications, Privacy & Presence
-- Creates the notifications table.
-- Note: `hidden` column on schedule_entries already exists from Phase 2.

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade not null,
  message     text not null,
  link        text,           -- optional deep link (e.g. '/tasks', '/groups/abc')
  read        boolean default false,
  created_at  timestamptz default now()
);

alter table public.notifications enable row level security;

-- Users can read their own notifications
create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- Users can insert their own notifications (for task reminders, etc.)
create policy "Users can insert own notifications"
  on public.notifications for insert
  with check (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- Users can delete their own notifications
create policy "Users can delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);

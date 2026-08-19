-- Phase 5: Deadlines & Tasks (personal + group)
-- Creates the tasks table with full RLS for owner + group member access.

-- ============================================================
-- TASKS
-- ============================================================
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete cascade not null,
  group_id    uuid references public.groups(id) on delete cascade null,  -- null = personal task
  title       text not null,
  description text,
  due_at      timestamptz,
  status      text default 'open' check (status in ('open', 'done')),
  assignee_id uuid references public.profiles(id) on delete set null,   -- optional: assigned group member
  created_at  timestamptz default now()
);

alter table public.tasks enable row level security;

-- ============================================================
-- RLS Policies
-- ============================================================

-- Owner can do everything with their own tasks (personal or group-owned)
create policy "Owner can manage own tasks"
  on public.tasks for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Group members can read tasks that belong to their group
create policy "Group members can view group tasks"
  on public.tasks for select
  using (
    group_id is not null
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = tasks.group_id
        and gm.user_id = auth.uid()
    )
  );

-- Group members can insert tasks into groups they belong to
create policy "Group members can create group tasks"
  on public.tasks for insert
  with check (
    group_id is not null
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = tasks.group_id
        and gm.user_id = auth.uid()
    )
  );

-- Any group member can update tasks in their group (mark done, edit)
create policy "Group members can update group tasks"
  on public.tasks for update
  using (
    group_id is not null
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = tasks.group_id
        and gm.user_id = auth.uid()
    )
  );

-- Any group member can delete tasks in their group
create policy "Group members can delete group tasks"
  on public.tasks for delete
  using (
    group_id is not null
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = tasks.group_id
        and gm.user_id = auth.uid()
    )
  );

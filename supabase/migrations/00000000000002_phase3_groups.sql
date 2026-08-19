-- Phase 3: Groups (create/invite/join)
-- Creates groups and group_members tables.
-- Updates schedule_entries RLS to allow cross-group reading.

-- ============================================================
-- GROUPS
-- ============================================================
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  invite_code text unique not null default substr(md5(random()::text), 1, 8),
  owner_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now()
);

alter table public.groups enable row level security;

-- Anyone authenticated can view groups (needed for join flow to verify invite codes)
create policy "Authenticated users can view groups"
  on public.groups for select
  using (auth.role() = 'authenticated');

-- Any authenticated user can create a group
create policy "Authenticated users can create groups"
  on public.groups for insert
  with check (auth.uid() = owner_id);

-- Only the owner can update their group
create policy "Owner can update group"
  on public.groups for update
  using (auth.uid() = owner_id);

-- Only the owner can delete their group
create policy "Owner can delete group"
  on public.groups for delete
  using (auth.uid() = owner_id);

-- ============================================================
-- GROUP MEMBERS
-- ============================================================
create table public.group_members (
  group_id  uuid references public.groups(id) on delete cascade not null,
  user_id   uuid references public.profiles(id) on delete cascade not null,
  role      text default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

-- Members can see who's in groups they belong to
create policy "Members can view group members"
  on public.group_members for select
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
    )
  );

-- Anyone authenticated can join a group (the invite code is the security)
create policy "Authenticated users can join groups"
  on public.group_members for insert
  with check (auth.uid() = user_id);

-- Members can leave a group (delete their own membership)
create policy "Members can leave group"
  on public.group_members for delete
  using (auth.uid() = user_id);

-- Owner can remove members from their group
create policy "Owner can remove members"
  on public.group_members for delete
  using (
    exists (
      select 1 from public.groups
      where groups.id = group_members.group_id
        and groups.owner_id = auth.uid()
    )
  );

-- ============================================================
-- UPDATE: schedule_entries RLS for cross-group reading
-- Phase 4 depends on this: a user can read another user's
-- schedule_entries only if they share at least one group.
-- ============================================================

-- Drop the existing owner-only select policy
drop policy if exists "Users can view own schedule entries" on public.schedule_entries;

-- Replace with: owner can see their own, OR anyone in a shared group can see it
create policy "Users can view schedule entries"
  on public.schedule_entries for select
  using (
    -- Owner can always see their own entries
    exists (
      select 1 from public.schedules
      where schedules.id = schedule_entries.schedule_id
        and schedules.user_id = auth.uid()
    )
    or
    -- Group members can see entries of other group members
    exists (
      select 1
      from public.schedules s
      join public.group_members gm_self on gm_self.user_id = auth.uid()
      join public.group_members gm_other on gm_other.group_id = gm_self.group_id
      where s.id = schedule_entries.schedule_id
        and s.user_id = gm_other.user_id
    )
  );

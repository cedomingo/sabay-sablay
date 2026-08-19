-- Phase 3 added cross-group reading for `schedule_entries` but never
-- extended the same visibility to the parent `schedules` table itself,
-- nor to `profiles`. Net effect: getGroupSchedule() could only ever see
-- the current user's own `schedules` row (RLS silently drops the rest),
-- so group-mates' classes never showed up in the combined view — and
-- separately, any join to `profiles` for a group-mate's full_name /
-- avatar_url came back null, showing as "Unknown" in the UI.

-- ============================================================
-- schedules: allow reading a group-mate's schedule row
-- ============================================================

drop policy if exists "Users can view own schedules" on public.schedules;

create policy "Users can view schedules"
  on public.schedules for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.group_members gm_self
      join public.group_members gm_other on gm_other.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid()
        and gm_other.user_id = schedules.user_id
    )
  );

-- ============================================================
-- profiles: allow reading a group-mate's profile (name/avatar)
-- Added as an additional permissive policy alongside the existing
-- "Users can view own profile" policy — Postgres RLS OR's multiple
-- permissive policies together, so both stay in effect.
-- ============================================================

create policy "Group members can view each other's profiles"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.group_members gm_self
      join public.group_members gm_other on gm_other.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid()
        and gm_other.user_id = profiles.id
    )
  );

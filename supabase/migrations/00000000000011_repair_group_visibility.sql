-- Repair migration: consolidates group-mate visibility RLS onto two
-- SECURITY DEFINER helper functions, and re-creates every policy that
-- depends on cross-user group membership.
--
-- Why this is needed: migrations 00000000000006 (group_visibility_fixes)
-- and 00000000000007 (fix_group_members_recursion) each modified part of
-- this picture, but 006's "profiles"/"schedules" policies do a raw
-- self-join back into group_members instead of going through 007's fix.
-- If either of those two migrations partially failed to apply on the
-- remote (the same class of drift we hit with the storage policies),
-- the live database can end up with a `group_members` policy that's
-- still recursive, or a `profiles`/`schedules` policy that depends on
-- a `group_members` state that was never actually applied. Symptom:
-- your own data loads fine, but other members' names/rows silently
-- come back empty ("Unknown", "0 members") because RLS is quietly
-- filtering them out rather than erroring.
--
-- This migration is idempotent — every create is preceded by a
-- drop-if-exists, and every function uses `create or replace` — so it
-- can be safely re-run and will converge the database to one known-
-- correct state regardless of what's currently live.

-- ============================================================
-- Helper 1: is this user a member of this group?
-- SECURITY DEFINER means its internal query bypasses RLS, so calling
-- it from a policy ON group_members does not re-trigger that same
-- policy (no recursion).
-- ============================================================
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id
      and user_id = p_user_id
  );
$$;

revoke all on function public.is_group_member(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

-- ============================================================
-- Helper 2: do these two users share at least one group?
-- Used by profiles / schedules / schedule_entries policies instead of
-- each of them doing their own raw self-join into group_members.
-- ============================================================
create or replace function public.share_group(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.group_members gm_a
    join public.group_members gm_b on gm_b.group_id = gm_a.group_id
    where gm_a.user_id = p_user_a
      and gm_b.user_id = p_user_b
  );
$$;

revoke all on function public.share_group(uuid, uuid) from public;
grant execute on function public.share_group(uuid, uuid) to authenticated;

-- ============================================================
-- group_members: single non-recursive SELECT policy
-- ============================================================
drop policy if exists "Members can view group members" on public.group_members;
create policy "Members can view group members"
  on public.group_members for select
  using ( public.is_group_member(group_members.group_id, auth.uid()) );

-- ============================================================
-- groups: owner or member can view
-- ============================================================
drop policy if exists "Members and owner can view groups" on public.groups;
drop policy if exists "Authenticated users can view groups" on public.groups;
create policy "Members and owner can view groups"
  on public.groups for select
  using (
    auth.uid() = owner_id
    or public.is_group_member(groups.id, auth.uid())
  );

-- ============================================================
-- profiles: own profile, or a group-mate's profile
-- ============================================================
drop policy if exists "Group members can view each other's profiles" on public.profiles;
create policy "Group members can view each other's profiles"
  on public.profiles for select
  using ( public.share_group(auth.uid(), profiles.id) );

-- ============================================================
-- schedules: own schedule, or a group-mate's schedule
-- ============================================================
drop policy if exists "Users can view schedules" on public.schedules;
drop policy if exists "Users can view own schedules" on public.schedules;
create policy "Users can view schedules"
  on public.schedules for select
  using (
    auth.uid() = user_id
    or public.share_group(auth.uid(), schedules.user_id)
  );

-- ============================================================
-- schedule_entries: own entries (hidden or not), or a group-mate's
-- non-hidden entries
-- ============================================================
drop policy if exists "Users can view schedule entries" on public.schedule_entries;
create policy "Users can view schedule entries"
  on public.schedule_entries for select
  using (
    exists (
      select 1 from public.schedules
      where schedules.id = schedule_entries.schedule_id
        and schedules.user_id = auth.uid()
    )
    or (
      coalesce(schedule_entries.hidden, false) = false
      and exists (
        select 1 from public.schedules s
        where s.id = schedule_entries.schedule_id
          and public.share_group(auth.uid(), s.user_id)
      )
    )
  );

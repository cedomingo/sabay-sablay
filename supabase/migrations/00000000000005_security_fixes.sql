-- Phase 7 (security patch): fixes two RLS bugs found in review.
--
-- 1. `groups` was selectable by *any* authenticated user, which leaked
--    every group's invite_code — defeating "the invite code is the
--    security" model described in Phase 3. Anyone logged in could read
--    every invite code and join any group uninvited.
--
-- 2. The cross-group `schedule_entries` SELECT policy (added in Phase 3)
--    never checked the `hidden` column, so a group member could read
--    another member's "hidden" entries by querying the table directly
--    (bypassing the application-level `.eq("hidden", false)` filter,
--    which is not a security boundary on its own).

-- ============================================================
-- 1. Lock down groups SELECT to members/owner only
-- ============================================================

drop policy if exists "Authenticated users can view groups" on public.groups;

create policy "Members and owner can view groups"
  on public.groups for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
    )
  );

-- The join-by-invite-code flow (app/join/[code]) needs to look up a group
-- *before* the user is a member, so a plain table select no longer works
-- for them. Expose a narrow, security-definer RPC instead: it only ever
-- returns a single row for a caller who already knows the exact code,
-- so it doesn't reintroduce the enumeration problem above.
create or replace function public.get_group_by_invite_code(p_invite_code text)
returns table (
  id uuid,
  name text,
  description text,
  invite_code text,
  owner_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select id, name, description, invite_code, owner_id
  from public.groups
  where invite_code = p_invite_code
  limit 1;
$$;

revoke all on function public.get_group_by_invite_code(text) from public;
grant execute on function public.get_group_by_invite_code(text) to authenticated;

-- ============================================================
-- 2. Make the "hidden" toggle a real RLS guarantee, not just an
--    application-level filter
-- ============================================================

drop policy if exists "Users can view schedule entries" on public.schedule_entries;

create policy "Users can view schedule entries"
  on public.schedule_entries for select
  using (
    -- Owner can always see all of their own entries, hidden or not
    exists (
      select 1 from public.schedules
      where schedules.id = schedule_entries.schedule_id
        and schedules.user_id = auth.uid()
    )
    or
    -- Group members can see NON-HIDDEN entries of other group members
    (
      coalesce(schedule_entries.hidden, false) = false
      and exists (
        select 1
        from public.schedules s
        join public.group_members gm_self on gm_self.user_id = auth.uid()
        join public.group_members gm_other on gm_other.group_id = gm_self.group_id
        where s.id = schedule_entries.schedule_id
          and s.user_id = gm_other.user_id
      )
    )
  );

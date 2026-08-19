-- Fixes: "infinite recursion detected in policy for relation
-- group_members" (Postgres error 42P17).
--
-- The Phase 3 "Members can view group members" policy checked membership
-- by querying group_members from within a policy ON group_members. Every
-- evaluation of the policy re-triggers the same policy on the subquery,
-- causing infinite recursion.
--
-- Fix: move the membership check into a SECURITY DEFINER function.
-- Functions marked SECURITY DEFINER bypass RLS for their own internal
-- queries, so calling it from the policy doesn't re-trigger the policy.
-- This mirrors the get_group_by_invite_code pattern from the previous
-- security-fixes migration.

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

drop policy if exists "Members can view group members" on public.group_members;

create policy "Members can view group members"
  on public.group_members for select
  using (
    public.is_group_member(group_members.group_id, auth.uid())
  );

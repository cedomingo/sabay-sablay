"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// ============================================================
// Types
// ============================================================

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  profiles: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
}

export interface GroupWithMembers extends Group {
  group_members: GroupMember[];
}

// ============================================================
// Create Group
// ============================================================

export async function createGroup({
  name,
  description,
}: {
  name: string;
  description?: string;
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Create the group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({
      name,
      description: description || null,
      owner_id: user.id,
    })
    .select("id, invite_code")
    .single();

  if (groupError || !group) {
    console.error("Group create error:", groupError);
    throw new Error("Failed to create group");
  }

  // Add the creator as owner member
  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: group.id,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    console.error("Member insert error:", memberError);
    throw new Error("Failed to add you as group owner");
  }

  revalidatePath("/groups");
  redirect(`/groups/${group.id}`);
}

// ============================================================
// Join Group via Invite Code
// ============================================================

export async function joinGroup(inviteCode: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Look up group by invite code via the security-definer RPC — groups
  // is no longer directly selectable by non-members, so this is the only
  // way to resolve a code into a group id.
  const { data: groups, error: groupError } = await supabase.rpc(
    "get_group_by_invite_code",
    { p_invite_code: inviteCode }
  );

  const group = groups?.[0];

  if (groupError || !group) {
    throw new Error("Invalid invite code");
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", group.id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    // Join the group
    const { error: joinError } = await supabase.from("group_members").insert({
      group_id: group.id,
      user_id: user.id,
      role: "member",
    });

    if (joinError) {
      console.error("Join error:", joinError);
      throw new Error("Failed to join group");
    }
  }

  revalidatePath("/groups");
  revalidatePath(`/groups/${group.id}`);

  // If they haven't uploaded a schedule yet, send them there first —
  // the upload flow will land them straight on this group's weekly
  // schedule once they're done, instead of their personal one.
  const { data: schedule } = await supabase
    .from("schedules")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!schedule) {
    redirect(`/schedule/upload?groupId=${group.id}`);
  }

  redirect(`/groups/${group.id}`);
}

// ============================================================
// Leave Group
// ============================================================

export async function leaveGroup(groupId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Leave error:", error);
    throw new Error("Failed to leave group");
  }

  revalidatePath("/groups");
  redirect("/groups");
}

// ============================================================
// Remove Member (owner only)
// ============================================================

export async function removeMember(groupId: string, userId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Verify the caller is the owner
  const { data: group } = await supabase
    .from("groups")
    .select("owner_id")
    .eq("id", groupId)
    .single();

  if (!group || group.owner_id !== user.id) {
    throw new Error("Only the group owner can remove members");
  }

  // Can't remove yourself via this action (use leave instead)
  if (userId === user.id) {
    throw new Error("Use leave group instead of removing yourself");
  }

  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (error) {
    console.error("Remove error:", error);
    throw new Error("Failed to remove member");
  }

  revalidatePath(`/groups/${groupId}`);
}

// ============================================================
// Get User's Groups
// ============================================================

export async function getMyGroups(): Promise<GroupWithMembers[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Get all groups the user is a member of
  const { data: memberships, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);

  if (membershipError || !memberships || memberships.length === 0) {
    return [];
  }

  const groupIds = memberships.map((m) => m.group_id);

  // Fetch groups with their members
  const { data: groups, error: groupsError } = await supabase
    .from("groups")
    .select(`
      *,
      group_members (
        group_id,
        user_id,
        role,
        joined_at,
        profiles:user_id (
          id,
          full_name,
          avatar_url
        )
      )
    `)
    .in("id", groupIds);

  if (groupsError || !groups) {
    console.error("Groups fetch error:", groupsError);
    return [];
  }

  return groups as unknown as GroupWithMembers[];
}

// ============================================================
// Get Group Details
// ============================================================

export async function getGroup(groupId: string): Promise<GroupWithMembers | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Verify the user is a member
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    throw new Error("Not a member of this group");
  }

  const { data: group, error } = await supabase
    .from("groups")
    .select(`
      *,
      group_members (
        group_id,
        user_id,
        role,
        joined_at,
        profiles:user_id (
          id,
          full_name,
          avatar_url
        )
      )
    `)
    .eq("id", groupId)
    .single();

  if (error || !group) {
    console.error("Group fetch error:", error);
    return null;
  }

  return group as unknown as GroupWithMembers;
}

// ============================================================
// Delete Group (owner only)
// ============================================================

export async function deleteGroup(groupId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("groups")
    .delete()
    .eq("id", groupId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("Delete error:", error);
    throw new Error("Failed to delete group");
  }

  revalidatePath("/groups");
  redirect("/groups");
}

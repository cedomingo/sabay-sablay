"use server";

import { createClient } from "@/lib/supabase/server";

// ============================================================
// Types
// ============================================================

export interface GroupMemberEntry {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  entry: {
    id: string;
    day: string;
    start_display: string;
    end_display: string;
    start_minutes: number;
    end_minutes: number;
    subject: string;
    number: string;
    section: string;
    course_raw: string;
    room: string | null;
    enrichment_matched: boolean;
  };
}

export interface GroupScheduleData {
  groupName: string;
  memberCount: number;
  entries: GroupMemberEntry[];
  members: Array<{
    user_id: string;
    full_name: string;
    avatar_url: string | null;
  }>;
}

// ============================================================
// Fetch all group members' schedule entries
// Uses the Phase 3 RLS policy that allows cross-group reading.
// ============================================================

export async function getGroupSchedule(
  groupId: string
): Promise<GroupScheduleData | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Verify the user is a member
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) return null;

  // Get group info
  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", groupId)
    .single();

  // Get all members
  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, profiles:user_id (full_name, avatar_url)")
    .eq("group_id", groupId);

  if (!members || members.length === 0) {
    return {
      groupName: group?.name || "Group",
      memberCount: 0,
      entries: [],
      members: [],
    };
  }

  const memberUserIds = members.map((m) => m.user_id);

  // Fetch schedules for all group members. A member may have re-uploaded
  // their timetable, leaving more than one `schedules` row for the same
  // user_id — order newest-first and keep only each user's latest below,
  // same as the Personal Schedule page does, so old/duplicate uploads
  // don't double up entries in the group view.
  const { data: allSchedules } = await supabase
    .from("schedules")
    .select("id, user_id, created_at")
    .in("user_id", memberUserIds)
    .order("created_at", { ascending: false });

  const latestScheduleByUser = new Map<string, { id: string; user_id: string }>();
  for (const s of allSchedules || []) {
    if (!latestScheduleByUser.has(s.user_id)) {
      latestScheduleByUser.set(s.user_id, s);
    }
  }
  const schedules = Array.from(latestScheduleByUser.values());

  if (!schedules || schedules.length === 0) {
    return {
      groupName: group?.name || "Group",
      memberCount: members.length,
      entries: [],
      members: members.map((m) => ({
        user_id: m.user_id,
        full_name: (m.profiles as any)?.full_name || "Unknown",
        avatar_url: (m.profiles as any)?.avatar_url || null,
      })),
    };
  }

  const scheduleIds = schedules.map((s) => s.id);

  // Fetch all entries for these schedules
  // Thanks to Phase 3 RLS, cross-group reading is allowed
  // Phase 6: exclude hidden entries from group views
  const { data: entries } = await supabase
    .from("schedule_entries")
    .select("*")
    .in("schedule_id", scheduleIds)
    .eq("hidden", false)
    .order("start_minutes", { ascending: true });

  // Map entries back to their owners
  const scheduleOwnerMap = new Map(
    schedules.map((s) => [s.id, s.user_id])
  );

  const memberEntries: GroupMemberEntry[] = (entries || []).map((entry) => {
    const userId = scheduleOwnerMap.get(entry.schedule_id) || "";
    const member = members.find((m) => m.user_id === userId);
    return {
      user_id: userId,
      full_name: (member?.profiles as any)?.full_name || "Unknown",
      avatar_url: (member?.profiles as any)?.avatar_url || null,
      entry: {
        id: entry.id,
        day: entry.day,
        start_display: entry.start_display,
        end_display: entry.end_display,
        start_minutes: entry.start_minutes,
        end_minutes: entry.end_minutes,
        subject: entry.subject,
        number: entry.number,
        section: entry.section,
        course_raw: entry.course_raw,
        room: entry.room,
        enrichment_matched: entry.enrichment_matched,
      },
    };
  });

  return {
    groupName: group?.name || "Group",
    memberCount: members.length,
    entries: memberEntries,
    members: members.map((m) => ({
      user_id: m.user_id,
      full_name: (m.profiles as any)?.full_name || "Unknown",
      avatar_url: (m.profiles as any)?.avatar_url || null,
    })),
  };
}

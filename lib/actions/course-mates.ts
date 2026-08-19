"use server";

import { createClient } from "@/lib/supabase/server";

// ============================================================
// Types
// ============================================================

export interface CourseMate {
  subject: string;
  number: string;
  section: string;
  members: Array<{
    user_id: string;
    full_name: string;
    avatar_url: string | null;
  }>;
}

// ============================================================
// Course-mate Detection
// ============================================================

/**
 * Find courses shared by 2+ members in a group.
 * Returns a list of shared courses with the members taking each.
 */
export async function getCourseMates(
  groupId: string
): Promise<CourseMate[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  // Verify the user is a member
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) return [];

  // Get all members
  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, profiles:user_id (full_name, avatar_url)")
    .eq("group_id", groupId);

  if (!members || members.length < 2) return [];

  const memberUserIds = members.map((m) => m.user_id);

  // Fetch schedules for all members
  const { data: schedules } = await supabase
    .from("schedules")
    .select("id, user_id")
    .in("user_id", memberUserIds);

  if (!schedules || schedules.length === 0) return [];

  const scheduleIds = schedules.map((s) => s.id);
  const scheduleOwnerMap = new Map(schedules.map((s) => [s.id, s.user_id]));

  // Fetch all visible entries
  const { data: entries } = await supabase
    .from("schedule_entries")
    .select("schedule_id, subject, number, section")
    .in("schedule_id", scheduleIds)
    .eq("hidden", false);

  if (!entries || entries.length === 0) return [];

  // Group entries by subject+number+section and track which members take each
  const courseMap = new Map<
    string,
    {
      subject: string;
      number: string;
      section: string;
      memberIds: Set<string>;
    }
  >();

  for (const entry of entries) {
    const userId = scheduleOwnerMap.get(entry.schedule_id);
    if (!userId) continue;

    const key = `${entry.subject}|${entry.number}|${entry.section}`;
    const existing = courseMap.get(key);

    if (existing) {
      existing.memberIds.add(userId);
    } else {
      courseMap.set(key, {
        subject: entry.subject,
        number: entry.number,
        section: entry.section,
        memberIds: new Set([userId]),
      });
    }
  }

  // Filter to courses with 2+ members
  const sharedCourses: CourseMate[] = [];

  for (const course of courseMap.values()) {
    if (course.memberIds.size >= 2) {
      const courseMembers = members
        .filter((m) => course.memberIds.has(m.user_id))
        .map((m) => ({
          user_id: m.user_id,
          full_name: (m.profiles as any)?.full_name || "Unknown",
          avatar_url: (m.profiles as any)?.avatar_url || null,
        }));

      sharedCourses.push({
        subject: course.subject,
        number: course.number,
        section: course.section,
        members: courseMembers,
      });
    }
  }

  // Sort by number of shared members (most shared first)
  sharedCourses.sort((a, b) => b.members.length - a.members.length);

  return sharedCourses;
}

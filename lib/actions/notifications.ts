"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ============================================================
// Types
// ============================================================

export interface Notification {
  id: string;
  user_id: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

// ============================================================
// Fetch
// ============================================================

/** Get all notifications for the current user, newest first. */
export async function getNotifications(): Promise<Notification[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Fetch notifications error:", error);
    return [];
  }

  return (data || []) as Notification[];
}

/** Get count of unread notifications. */
export async function getUnreadCount(): Promise<number> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return 0;

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);

  if (error) {
    console.error("Unread count error:", error);
    return 0;
  }

  return count || 0;
}

// ============================================================
// Mutations
// ============================================================

/** Mark a single notification as read. */
export async function markAsRead(notificationId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Mark read error:", error);
    throw new Error("Failed to mark notification as read");
  }

  revalidatePath("/notifications");
}

/** Mark all notifications as read for the current user. */
export async function markAllAsRead() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", user.id)
    .eq("read", false);

  if (error) {
    console.error("Mark all read error:", error);
    throw new Error("Failed to mark notifications as read");
  }

  revalidatePath("/notifications");
}

// ============================================================
// Notification Generation
// ============================================================

/**
 * Check for tasks approaching their due date and create notifications
 * for any that don't already have a recent notification.
 * Should be called on page loads or after task creation.
 */
export async function checkDueDateNotifications() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Find open tasks due within the next 3 days
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  // Personal tasks due soon
  const { data: personalTasks } = await supabase
    .from("tasks")
    .select("id, title, due_at, group_id")
    .is("group_id", null)
    .eq("owner_id", user.id)
    .eq("status", "open")
    .not("due_at", "is", null)
    .lte("due_at", threeDaysFromNow.toISOString())
    .gte("due_at", now.toISOString());

  // Group tasks due soon (where user is a member)
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);

  let groupTasks: any[] = [];
  if (memberships && memberships.length > 0) {
    const groupIds = memberships.map((m) => m.group_id);
    const { data: gt } = await supabase
      .from("tasks")
      .select("id, title, due_at, group_id")
      .in("group_id", groupIds)
      .eq("status", "open")
      .not("due_at", "is", null)
      .lte("due_at", threeDaysFromNow.toISOString())
      .gte("due_at", now.toISOString());

    groupTasks = gt || [];
  }

  const allTasks = [...((personalTasks || []) as any[]), ...groupTasks];

  // For each task, check if we already have a recent notification (within 12 hours)
  const twelveHoursAgo = new Date(now);
  twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

  for (const task of allTasks) {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", user.id)
      .like("message", `%${task.title}%`)
      .gte("created_at", twelveHoursAgo.toISOString())
      .limit(1);

    if (existing && existing.length > 0) continue;

    const dueDate = new Date(task.due_at);
    const diffMs = dueDate.getTime() - now.getTime();
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

    let message: string;
    let link: string | null = null;

    if (diffHours <= 1) {
      message = `⚠️ "${task.title}" is due within the hour!`;
      link = "/tasks";
    } else if (diffHours <= 24) {
      message = `⏰ "${task.title}" is due tomorrow`;
      link = "/tasks";
    } else {
      const days = Math.ceil(diffHours / 24);
      message = `📅 "${task.title}" is due in ${days} days`;
      link = "/tasks";
    }

    await supabase.from("notifications").insert({
      user_id: user.id,
      message,
      link,
    });
  }
}

// ============================================================
// Cleanup
// ============================================================

/** Delete all read notifications for the current user. */
export async function clearReadNotifications() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("user_id", user.id)
    .eq("read", true);

  if (error) {
    console.error("Clear notifications error:", error);
    throw new Error("Failed to clear notifications");
  }

  revalidatePath("/notifications");
}

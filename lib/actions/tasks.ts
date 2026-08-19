"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ============================================================
// Types
// ============================================================

export interface Task {
  id: string;
  owner_id: string;
  group_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  status: "open" | "done";
  assignee_id: string | null;
  created_at: string;
  // Calendar tab: optional room + raw time-of-day (null = no specific time)
  room?: string | null;
  due_time?: string | null;
  // Calendar tab: multi-day events. When set, the task spans from
  // due_at's date through end_date (inclusive) instead of a single day.
  end_date?: string | null;
  // Joined fields (optional)
  profiles?: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  assignee?: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  groups?: {
    id: string;
    name: string;
  } | null;
}

// ============================================================
// Personal Tasks
// ============================================================

/** Get all personal tasks for the current user (no group_id). */
export async function getPersonalTasks(): Promise<Task[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .is("group_id", null)
    .eq("owner_id", user.id)
    .order("due_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fetch personal tasks error:", error);
    return [];
  }

  return (tasks || []) as Task[];
}

/**
 * Get every task visible on the user's personal calendar: their own
 * personal tasks, plus every open+done task from every group they
 * belong to. This is what makes a group task "reflect in your personal
 * schedule" once someone adds it on the group's calendar tab.
 */
export async function getAllVisibleTasks(): Promise<Task[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: personalTasks, error: personalError } = await supabase
    .from("tasks")
    .select("*, groups!tasks_group_id_fkey(id, name)")
    .is("group_id", null)
    .eq("owner_id", user.id);

  if (personalError) {
    console.error("Fetch personal tasks error:", personalError);
  }

  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);

  let groupTasks: Task[] = [];
  if (memberships && memberships.length > 0) {
    const groupIds = memberships.map((m) => m.group_id);
    const { data: gt, error: groupError } = await supabase
      .from("tasks")
      .select("*, groups!tasks_group_id_fkey(id, name)")
      .in("group_id", groupIds);

    if (groupError) {
      console.error("Fetch group tasks for calendar error:", groupError);
    }
    groupTasks = (gt || []) as Task[];
  }

  const all = [...((personalTasks || []) as Task[]), ...groupTasks];
  all.sort((a, b) => {
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  });

  return all;
}

/** Get upcoming personal + group tasks sorted by due date. */
export async function getUpcomingTasks(limit = 10): Promise<Task[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Get personal tasks
  const { data: personalTasks } = await supabase
    .from("tasks")
    .select("*, groups!tasks_group_id_fkey(id, name)")
    .is("group_id", null)
    .eq("owner_id", user.id)
    .eq("status", "open")
    .not("due_at", "is", null)
    .order("due_at", { ascending: true })
    .limit(limit);

  // Get group tasks the user is a member of
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);

  let groupTasks: Task[] = [];
  if (memberships && memberships.length > 0) {
    const groupIds = memberships.map((m) => m.group_id);
    const { data: gt } = await supabase
      .from("tasks")
      .select("*, groups!tasks_group_id_fkey(id, name), profiles!tasks_owner_id_fkey(full_name, avatar_url)")
      .in("group_id", groupIds)
      .eq("status", "open")
      .not("due_at", "is", null)
      .order("due_at", { ascending: true })
      .limit(limit);

    groupTasks = (gt || []) as Task[];
  }

  // Merge and sort by due_at
  const all = [...((personalTasks || []) as Task[]), ...groupTasks];
  all.sort((a, b) => {
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  });

  return all.slice(0, limit);
}

// ============================================================
// Group Tasks
// ============================================================

/** Get all tasks for a group. */
export async function getGroupTasks(groupId: string): Promise<Task[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Verify membership
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this group");

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(`
      *,
      profiles!tasks_owner_id_fkey(full_name, avatar_url),
      assignee:profiles!tasks_assignee_id_fkey(full_name, avatar_url)
    `)
    .eq("group_id", groupId)
    .order("status", { ascending: true })  // open first
    .order("due_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fetch group tasks error:", error);
    return [];
  }

  return (tasks || []) as unknown as Task[];
}

/**
 * Get a group's tasks for the group's Calendar tab. Same access check
 * as getGroupTasks, but unordered by status so ranged/timed events sit
 * naturally on the calendar grid.
 */
export async function getGroupCalendarTasks(groupId: string): Promise<Task[]> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this group");

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(`*, profiles!tasks_owner_id_fkey(full_name, avatar_url)`)
    .eq("group_id", groupId);

  if (error) {
    console.error("Fetch group calendar tasks error:", error);
    return [];
  }

  return (tasks || []) as unknown as Task[];
}

/** Get group members for assignment dropdown. */
export async function getGroupMembers(groupId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, profiles:user_id(full_name, avatar_url)")
    .eq("group_id", groupId);

  return (
    members?.map((m) => ({
      user_id: m.user_id,
      full_name: (m.profiles as any)?.full_name || "Unknown",
      avatar_url: (m.profiles as any)?.avatar_url || null,
    })) || []
  );
}

// ============================================================
// CRUD Actions
// ============================================================

/** Create a new personal task. */
export async function createPersonalTask({
  title,
  description,
  dueAt,
  room,
  dueTime,
  endDate,
}: {
  title: string;
  description?: string;
  dueAt?: string;
  room?: string;
  dueTime?: string;
  /** Inclusive end date ("YYYY-MM-DD") for a multi-day (ranged) event. */
  endDate?: string;
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("tasks").insert({
    owner_id: user.id,
    group_id: null,
    title,
    description: description || null,
    due_at: dueAt || null,
    room: room || null,
    due_time: dueTime || null,
    end_date: endDate || null,
  });

  if (error) {
    console.error("Create task error:", error);
    throw new Error("Failed to create task");
  }

  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
}

/**
 * Create a new group task, visible to every member. Accepts the same
 * calendar fields as createPersonalTask (room, time-of-day, multi-day
 * range) so it can be created from the group's Calendar tab, plus the
 * task-board-only assigneeId.
 */
export async function createGroupTask({
  groupId,
  title,
  description,
  dueAt,
  assigneeId,
  room,
  dueTime,
  endDate,
}: {
  groupId: string;
  title: string;
  description?: string;
  dueAt?: string;
  assigneeId?: string;
  room?: string;
  dueTime?: string;
  /** Inclusive end date ("YYYY-MM-DD") for a multi-day (ranged) event. */
  endDate?: string;
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("tasks").insert({
    owner_id: user.id,
    group_id: groupId,
    title,
    description: description || null,
    due_at: dueAt || null,
    assignee_id: assigneeId || null,
    room: room || null,
    due_time: dueTime || null,
    end_date: endDate || null,
  });

  if (error) {
    console.error("Create group task error:", error);
    throw new Error("Failed to create group task");
  }

  revalidatePath(`/groups/${groupId}/tasks`);
  revalidatePath(`/groups/${groupId}`);
  // Group tasks also show up on each member's personal calendar.
  revalidatePath("/calendar");
  revalidatePath("/schedule");
}

/** Toggle task status between 'open' and 'done'. */
export async function toggleTaskStatus(taskId: string, groupId?: string | null) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch current task
  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("status, group_id")
    .eq("id", taskId)
    .single();

  if (fetchError || !task) {
    throw new Error("Task not found");
  }

  const newStatus = task.status === "open" ? "done" : "open";

  const { error } = await supabase
    .from("tasks")
    .update({ status: newStatus })
    .eq("id", taskId);

  if (error) {
    console.error("Toggle task error:", error);
    throw new Error("Failed to update task");
  }

  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  if (task.group_id) {
    revalidatePath(`/groups/${task.group_id}/tasks`);
    revalidatePath(`/groups/${task.group_id}`);
  }
}

/** Update a task's fields. */
export async function updateTask(
  taskId: string,
  {
    title,
    description,
    dueAt,
    assigneeId,
    room,
    dueTime,
    endDate,
  }: {
    title?: string;
    description?: string | null;
    dueAt?: string | null;
    assigneeId?: string | null;
    room?: string | null;
    dueTime?: string | null;
    endDate?: string | null;
  }
) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (dueAt !== undefined) updates.due_at = dueAt;
  if (assigneeId !== undefined) updates.assignee_id = assigneeId;
  if (room !== undefined) updates.room = room;
  if (dueTime !== undefined) updates.due_time = dueTime;
  if (endDate !== undefined) updates.end_date = endDate;

  const { data: task } = await supabase
    .from("tasks")
    .select("group_id")
    .eq("id", taskId)
    .single();

  const { error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId);

  if (error) {
    console.error("Update task error:", error);
    throw new Error("Failed to update task");
  }

  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  if (task?.group_id) {
    revalidatePath(`/groups/${task.group_id}/tasks`);
    revalidatePath(`/groups/${task.group_id}`);
  }
}

// ============================================================
// Gamification: Streaks
// ============================================================

/**
 * Calculate the user's task completion streak.
 * A streak is consecutive days where at least one task was completed.
 * Returns { currentStreak, longestStreak, completedToday }.
 */
export async function getTaskStreak(): Promise<{
  currentStreak: number;
  longestStreak: number;
  completedToday: number;
}> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { currentStreak: 0, longestStreak: 0, completedToday: 0 };

  // Fetch all done tasks for this user, ordered by created_at
  // (tasks don't have a completed_at, so we use created_at as a proxy
  //  — the streak counts days where tasks exist that were created)
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, created_at, status")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(365);

  if (!tasks || tasks.length === 0) {
    return { currentStreak: 0, longestStreak: 0, completedToday: 0 };
  }

  // For streak calculation, we check days where tasks were toggled to done.
  // Since we don't track completed_at, we'll approximate by checking
  // done tasks and grouping by day.
  const doneTasks = tasks.filter((t) => t.status === "done");

  if (doneTasks.length === 0) {
    return { currentStreak: 0, longestStreak: 0, completedToday: 0 };
  }

  // Get unique dates where tasks were completed (by created_at)
  const completedDays = new Set<string>();
  for (const task of doneTasks) {
    const d = new Date(task.created_at);
    completedDays.add(
      `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    );
  }

  // Check if completed today
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const completedToday = completedDays.has(todayKey) ? 1 : 0;

  // Calculate current streak (consecutive days from today backwards)
  let currentStreak = 0;
  let checkDate = new Date(today);

  // If not completed today, start checking from yesterday
  if (!completedDays.has(todayKey)) {
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (true) {
    const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
    if (completedDays.has(key)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Calculate longest streak
  const sortedDays = Array.from(completedDays)
    .map((d) => {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(y, m, day).getTime();
    })
    .sort((a, b) => a - b);

  let longestStreak = 0;
  let streak = 1;

  for (let i = 1; i < sortedDays.length; i++) {
    const diff = sortedDays[i] - sortedDays[i - 1];
    const oneDay = 1000 * 60 * 60 * 24;
    if (Math.abs(diff - oneDay) < 1000 * 60) {
      streak++;
    } else {
      longestStreak = Math.max(longestStreak, streak);
      streak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, streak, currentStreak);

  return { currentStreak, longestStreak, completedToday };
}

/** Delete a task. */
export async function deleteTask(taskId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: task } = await supabase
    .from("tasks")
    .select("group_id")
    .eq("id", taskId)
    .single();

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) {
    console.error("Delete task error:", error);
    throw new Error("Failed to delete task");
  }

  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  if (task?.group_id) {
    revalidatePath(`/groups/${task.group_id}/tasks`);
    revalidatePath(`/groups/${task.group_id}`);
  }
}

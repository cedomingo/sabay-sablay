"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// ============================================================
// Types
// ============================================================

export interface ProfileData {
  id: string;
  full_name: string | null;
  school_email: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
  created_at: string;
}

function sanitizeName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("Please tell us what to call you");
  if (trimmed.length > 80) {
    throw new Error("That name's a bit long — try something shorter");
  }
  return trimmed;
}

// Only ever redirect to a relative, in-app path — never trust a raw
// "next" value as an absolute/external URL.
function safeNext(next: string | undefined | null, fallback: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return fallback;
}

// ============================================================
// Get current user's profile
// ============================================================

export async function getMyProfile(): Promise<ProfileData | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data;
}

// ============================================================
// First-time onboarding: set the display name and unlock the app
// ============================================================

export async function completeOnboarding(name: string, next?: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const trimmed = sanitizeName(name);

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: trimmed, onboarding_completed: true })
    .eq("id", user.id);

  if (error) {
    console.error("Onboarding update error:", error);
    throw new Error("Failed to save your name");
  }

  revalidatePath("/", "layout");
  redirect(safeNext(next, "/schedule/upload"));
}

// ============================================================
// Update display name (from the Profile tab, after onboarding)
// ============================================================

export async function updateDisplayName(name: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const trimmed = sanitizeName(name);

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: trimmed })
    .eq("id", user.id);

  if (error) {
    console.error("Update name error:", error);
    throw new Error("Failed to update your name");
  }

  revalidatePath("/", "layout");
  return { full_name: trimmed };
}

// ============================================================
// Manage uploaded schedule (Profile tab)
// ============================================================

export interface MyScheduleSummary {
  id: string;
  label: string | null;
  total_units: number | null;
  created_at: string;
  entryCount: number;
}

export async function getMyScheduleSummary(): Promise<MyScheduleSummary | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: schedule } = await supabase
    .from("schedules")
    .select("id, label, total_units, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!schedule) return null;

  const { count } = await supabase
    .from("schedule_entries")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", schedule.id);

  return { ...schedule, entryCount: count ?? 0 };
}

export async function deleteMySchedule() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // schedule_entries cascade-deletes with the parent schedule row.
  const { error } = await supabase
    .from("schedules")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    console.error("Delete schedule error:", error);
    throw new Error("Failed to delete your schedule");
  }

  revalidatePath("/profile");
  revalidatePath("/schedule");
}

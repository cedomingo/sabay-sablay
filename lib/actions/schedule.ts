"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { parseCrsSchedule } from '@/lib/crs-monitor/matcher';

export interface ScheduleEntryInput {
  day: string;
  start_display: string;
  end_display: string;
  start_minutes: number;
  end_minutes: number;
  subject: string;
  number: string;
  section: string;
  course_raw: string;
  // CRS-Monitor enrichment
  crs_class_code?: string | null;
  room?: string | null;
  available_slots?: number | null;
  total_slots?: number | null;
  enrichment_matched?: boolean;
}

/**
 * Save a confirmed schedule with its entries to the database.
 * Creates a schedule row + all schedule_entries rows in one transaction.
 */
export async function saveSchedule({
  label,
  totalUnits,
  imagePath,
  entries,
}: {
  label?: string;
  totalUnits?: number;
  imagePath: string;
  entries: ScheduleEntryInput[];
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Create the schedule row
  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .insert({
      user_id: user.id,
      label: label || null,
      total_units: totalUnits || null,
      source_image_path: imagePath,
    })
    .select("id")
    .single();

  if (scheduleError || !schedule) {
    console.error("Schedule insert error:", scheduleError);
    throw new Error("Failed to save schedule");
  }

  // Insert all entries
  const entryRows = entries.map((e) => ({
    schedule_id: schedule.id,
    day: e.day,
    start_display: e.start_display,
    end_display: e.end_display,
    start_minutes: e.start_minutes,
    end_minutes: e.end_minutes,
    subject: e.subject,
    number: e.number,
    section: e.section,
    course_raw: e.course_raw,
    crs_class_code: e.crs_class_code || null,
    room: e.room || null,
    available_slots: e.available_slots ?? null,
    total_slots: e.total_slots ?? null,
    enrichment_matched: e.enrichment_matched ?? false,
  }));

  const { error: entriesError } = await supabase
    .from("schedule_entries")
    .insert(entryRows);

  if (entriesError) {
    console.error("Entries insert error:", entriesError);
    throw new Error("Failed to save schedule entries");
  }

  revalidatePath("/schedule");

  return { scheduleId: schedule.id };
}

/**
 * Fetch the current user's schedule with all entries.
 */
/**
 * Toggle the hidden flag on a schedule entry.
 * Hidden entries are excluded from group views but still visible to the owner.
 */
export async function toggleEntryHidden(entryId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch the entry to verify ownership
  const { data: entry } = await supabase
    .from("schedule_entries")
    .select("id, hidden, schedules!inner(user_id)")
    .eq("id", entryId)
    .single();

  if (!entry) throw new Error("Entry not found");
  if ((entry.schedules as any)?.user_id !== user.id) {
    throw new Error("Not authorized");
  }

  const { error } = await supabase
    .from("schedule_entries")
    .update({ hidden: !entry.hidden })
    .eq("id", entryId);

  if (error) {
    console.error("Toggle hidden error:", error);
    throw new Error("Failed to update entry visibility");
  }

  revalidatePath("/schedule");
  return { hidden: !entry.hidden };
}

export async function getMySchedule() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Get the most recent schedule
  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (scheduleError || !schedule) {
    return null;
  }

  // Get all entries for this schedule
  const { data: entries, error: entriesError } = await supabase
    .from("schedule_entries")
    .select("*")
    .eq("schedule_id", schedule.id)
    .order("start_minutes", { ascending: true });

  if (entriesError) {
    console.error("Entries fetch error:", entriesError);
    throw new Error("Failed to fetch schedule entries");
  }

  return {
    ...schedule,
    entries: entries || [],
  };
}

export async function saveEnrichedSchedule(
  userId: string, scheduleId: string, matched: any[], candidates: any[], unmatched: any[]
) {
  const supabase = createClient();

  for (const m of matched) {
    const { entry, crsSection, confidence } = m;
    const parsed = parseCrsSchedule(crsSection.schedule);

    // Overwrite behavior: delete existing day-rows for this class
    await supabase.from('schedule_entries').delete()
      .eq('schedule_id', scheduleId).eq('subject', entry.subject)
      .eq('number', entry.number).eq('section', entry.section);

    // Insert new day-rows from CRS data
    for (const block of parsed.blocks) {
      await supabase.from('schedule_entries').insert({
        schedule_id: scheduleId, user_id: userId, day: block.days.join(','),
        start_display: block.startTime, end_display: block.endTime,
        subject: entry.subject, number: entry.number, section: crsSection.section,
        course_raw: entry.course_raw, crs_class_code: crsSection.classCode,
        room: block.room ?? null, available_slots: crsSection.availableSlots,
        total_slots: crsSection.totalSlots, instructor: crsSection.instructor,
        remarks: crsSection.remarks, restrictions: crsSection.restrictions,
        enrichment_matched: true, match_confidence: confidence, raw_ocr_text: entry.rawText ?? null,
      });
    }
  }

  for (const c of candidates) {
    await supabase.from('schedule_entries').update({ match_candidates: c.candidates, match_confidence: c.confidence })
      .eq('schedule_id', scheduleId).eq('subject', c.entry.subject).eq('number', c.entry.number);
  }

  return { success: true, matchedCount: matched.length };
}
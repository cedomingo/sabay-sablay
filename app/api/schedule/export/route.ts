import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const DAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 0,
};

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatICSDate(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Find the next occurrence of a given day of week from a reference date.
 */
function getNextOccurrence(dayOfWeek: number, referenceDate: Date): Date {
  const date = new Date(referenceDate);
  const currentDay = date.getDay();
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  date.setDate(date.getDate() + daysUntil);
  return date;
}

export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Fetch the user's most recent schedule
  const { data: schedule } = await supabase
    .from("schedules")
    .select("id, label, user_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!schedule) {
    return NextResponse.json({ error: "No schedule found" }, { status: 404 });
  }

  // Fetch entries
  const { data: entries } = await supabase
    .from("schedule_entries")
    .select("*")
    .eq("schedule_id", schedule.id)
    .order("start_minutes", { ascending: true });

  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: "No entries found" }, { status: 404 });
  }

  // Build .ics content
  const now = new Date();
  const nowStr = formatICSDate(now);

  // Generate events for the next 16 weeks (one semester)
  const WEEKS_TO_EXPORT = 16;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Schedule Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICS(schedule.label || "My Schedule")}`,
    "X-WR-TIMEZONE:Asia/Manila",
  ];

  for (const entry of entries) {
    const dayNum = DAY_MAP[entry.day];
    if (dayNum === undefined) continue;

    const startH = Math.floor(entry.start_minutes / 60);
    const startM = entry.start_minutes % 60;
    const endH = Math.floor(entry.end_minutes / 60);
    const endM = entry.end_minutes % 60;

    // Generate one event per week for WEEKS_TO_EXPORT weeks
    for (let week = 0; week < WEEKS_TO_EXPORT; week++) {
      const baseDate = getNextOccurrence(dayNum, now);
      baseDate.setDate(baseDate.getDate() + week * 7);

      const eventStart = new Date(baseDate);
      eventStart.setUTCHours(startH, startM, 0, 0);

      const eventEnd = new Date(baseDate);
      eventEnd.setUTCHours(endH, endM, 0, 0);

      // Skip events in the past
      if (eventEnd < now) continue;

      const summary = `${entry.subject} ${entry.number}`;
      const description = [
        entry.course_raw ? `Course: ${entry.course_raw}` : null,
        entry.section ? `Section: ${entry.section}` : null,
        entry.room ? `Room: ${entry.room}` : null,
      ]
        .filter(Boolean)
        .join("\\n");

      const uid = `${entry.id}-${week}@schedule-planner`;

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${nowStr}`,
        `DTSTART:${formatICSDate(eventStart)}`,
        `DTEND:${formatICSDate(eventEnd)}`,
        `SUMMARY:${escapeICS(summary)}`,
        description ? `DESCRIPTION:${escapeICS(description)}` : "",
        entry.room ? `LOCATION:${escapeICS(entry.room)}` : "",
        "END:VEVENT"
      );
    }
  }

  lines.push("END:VCALENDAR");

  const icsContent = lines.filter((l) => l !== "").join("\r\n");

  return new NextResponse(icsContent, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${schedule.label || "schedule"}.ics"`,
    },
  });
}

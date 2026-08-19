import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LayoutGrid, Upload, MapPin, LogOut, Users, ListChecks, UserRound } from "lucide-react";
import { revalidatePath } from "next/cache";
import { getUpcomingTasks, getAllVisibleTasks } from "@/lib/actions/tasks";
import { checkDueDateNotifications } from "@/lib/actions/notifications";
import NotificationBell from "@/components/NotificationBell";
import PrivacyToggle from "@/components/PrivacyToggle";
import SubmitButton from "@/components/SubmitButton";
import ScheduleTabs from "./ScheduleTabs";
import CalendarView from "../calendar/CalendarView";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Timeline starts at 7:00 AM (420 minutes since midnight).
// Hour marks are reference lines only — blocks are positioned by exact minute.
const HOUR_START = 420;
const DEFAULT_HOUR_END = 1020; // 5:00 PM baseline, extended if entries run later
const PIXELS_PER_MINUTE = 1.2; // 72px per hour

function formatHourLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:00 ${period}`;
}

const COLORS = [
  { bg: "bg-[#F4A28C]", text: "text-[#512E2B]", border: "border-[#DC7C66]" },
  { bg: "bg-[#8DDDD0]", text: "text-[#163D3A]", border: "border-[#56B9AC]" },
  { bg: "bg-[#C9B9E9]", text: "text-[#34264F]", border: "border-[#A991D1]" },
  { bg: "bg-[#F6D486]", text: "text-[#4C3911]", border: "border-[#DDB35A]" },
  { bg: "bg-[#D9E7DE]", text: "text-[#286057]", border: "border-[#B9D4C4]" },
];

function getDayIndex(day: string): number {
  const map: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  return map[day] ?? 0;
}

function getColorForSubject(subject: string) {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) {
    hash = subject.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

// Lays out a single day's entries on a continuous timeline. Entries that
// don't overlap in time each get the full column width; entries that do
// overlap are grouped into a cluster and placed side-by-side within it.
function layoutDayEntries<T extends { start_minutes: number; end_minutes: number }>(
  entries: T[]
): Array<T & { col: number; colCount: number }> {
  const sorted = [...entries].sort((a, b) => a.start_minutes - b.start_minutes);
  const result: Array<T & { col: number; colCount: number }> = [];

  let cluster: T[] = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    for (const entry of cluster) {
      let col = colEnds.findIndex((end) => end <= entry.start_minutes);
      if (col === -1) {
        colEnds.push(entry.end_minutes);
        col = colEnds.length - 1;
      } else {
        colEnds[col] = entry.end_minutes;
      }
      result.push({ ...entry, col, colCount: 0 });
    }
    const colCount = colEnds.length;
    for (let i = result.length - cluster.length; i < result.length; i++) {
      result[i].colCount = colCount;
    }
    cluster = [];
  };

  for (const entry of sorted) {
    if (cluster.length === 0 || entry.start_minutes < clusterEnd) {
      cluster.push(entry);
      clusterEnd = Math.max(clusterEnd, entry.end_minutes);
    } else {
      flushCluster();
      cluster = [entry];
      clusterEnd = entry.end_minutes;
    }
  }
  flushCluster();

  return result;
}

interface ScheduleEntry {
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
  hidden: boolean;
  enrichment_matched: boolean;
}

interface ScheduleData {
  id: string;
  label: string | null;
  total_units: number | null;
  created_at: string;
  entries: ScheduleEntry[];
}

async function getSchedule(): Promise<ScheduleData | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: schedule } = await supabase
    .from("schedules")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!schedule) return null;

  const { data: entries } = await supabase
    .from("schedule_entries")
    .select("*")
    .eq("schedule_id", schedule.id)
    .order("start_minutes", { ascending: true });

  return {
    ...schedule,
    entries: entries || [],
  };
}

async function handleSignOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const [schedule, upcomingTasks, calendarTasks] = await Promise.all([
    getSchedule(),
    getUpcomingTasks(5),
    getAllVisibleTasks(),
  ]);

  const initialTab = searchParams?.tab === "calendar" ? "calendar" : "schedule";

  // Generate due-date notifications in the background (non-blocking)
  checkDueDateNotifications().catch(() => {});

  if (!schedule) {
    return (
      <main className="min-h-[100dvh] bg-[#F4F1E9]">
        <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
          <div className="mx-auto max-w-6xl relative z-10 flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
              <LayoutGrid size={18} />
            </div>
            <span className="font-display text-sm font-bold tracking-tight">
              Schedule Planner
            </span>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
          <ScheduleTabs
            initialTab={initialTab}
            scheduleTab={
              <div className="mx-auto max-w-3xl py-12 text-center">
                <div className="paper-grid inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F6D486] text-[#765514]">
                  <Upload size={24} />
                </div>
                <h1 className="mt-6 font-display text-2xl font-semibold text-[#214746]">
                  Your week is a blank page.
                </h1>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#717972]">
                  Upload a timetable and we&apos;ll turn the fixed bits into a map you
                  can actually read.
                </p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <a
                    href="/schedule/upload"
                    className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5"
                  >
                    <Upload size={16} />
                    Upload timetable
                  </a>
                  <a
                    href="/groups"
                    className="inline-flex items-center gap-2 rounded-xl border border-[#C8C6BD] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
                  >
                    <Users size={16} />
                    My groups
                  </a>
                </div>
              </div>
            }
            calendarTab={<CalendarView initialTasks={calendarTasks} />}
          />
        </div>
      </main>
    );
  }

  // Group entries by subject for color assignment
  const subjects = [...new Set(schedule.entries.map((e) => e.subject))];
  const subjectColorMap = new Map<string, typeof COLORS[0]>();
  subjects.forEach((s, i) => {
    subjectColorMap.set(s, COLORS[i % COLORS.length]);
  });

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      {/* Header */}
      <div className="grain relative overflow-hidden bg-[#214746] px-6 py-6 text-[#F4F1E9] md:px-10">
        <div className="mx-auto max-w-6xl relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F4A28C] text-[#214746]">
                <LayoutGrid size={18} />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">
                Schedule Planner
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <a
                href="/groups"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <Users size={14} />
                My groups
              </a>
              <a
                href="/profile"
                className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                <UserRound size={14} />
                Profile
              </a>
              <form action={handleSignOut}>
                <SubmitButton
                  icon={<LogOut size={14} />}
                  pendingChildren="Signing out..."
                  className="inline-flex items-center gap-2 rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855] disabled:opacity-60"
                >
                  Sign out
                </SubmitButton>
              </form>
            </div>
          </div>

          <div className="mt-6 flex items-end justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
                {schedule.label || "My schedule"}
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                Weekly grid
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {schedule.total_units && (
                <div className="rounded-full border border-[#A9D8CA]/25 bg-[#2B5855] px-3 py-1.5">
                  <span className="font-mono text-xs text-[#A9D8CA]">
                    {schedule.total_units} units
                  </span>
                </div>
              )}
              <a
                href="/schedule/upload"
                className="rounded-xl border border-[#A9D8CA]/30 px-3 py-2 text-xs font-semibold text-[#A9D8CA] hover:bg-[#2B5855]"
              >
                Upload new
              </a>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-16 -right-8 h-40 w-40 rounded-full border-[16px] border-[#F6D486]/20" />
      </div>

      {/* Schedule / Calendar tabs */}
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        <ScheduleTabs
          initialTab={initialTab}
          calendarTab={<CalendarView initialTasks={calendarTasks} />}
          scheduleTab={
            <>
        <div className="overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
          {/* Grid Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D8D6CD] px-4 py-4 md:px-6">
            <div>
              <p className="font-display text-lg font-semibold text-[#214746]">
                Week of{" "}
                {new Date().toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                Personal view
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#65716B]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F4A28C]" />
              occupied
              <span className="ml-2 h-2.5 w-2.5 rounded-full border border-[#9FB9AE] bg-[#E5EDE6]" />
              free
            </div>
          </div>

          {/* Grid Body — continuous, time-based timeline (not a fixed-row table) */}
          <div className="min-w-[720px] overflow-x-auto p-3 md:p-5">
            {(() => {
              const maxEndMinutes = schedule.entries.length
                ? Math.max(...schedule.entries.map((e) => e.end_minutes))
                : DEFAULT_HOUR_END;
              const hourEnd = Math.max(
                DEFAULT_HOUR_END,
                Math.ceil(maxEndMinutes / 60) * 60
              );
              const hours: number[] = [];
              for (let h = HOUR_START; h <= hourEnd; h += 60) hours.push(h);
              const timelineHeight = (hourEnd - HOUR_START) * PIXELS_PER_MINUTE;

              return (
                <div className="grid grid-cols-[74px_repeat(5,minmax(118px,1fr))]">
                  {/* Day Headers */}
                  <div className="h-12" />
                  {DAYS.map((day, i) => (
                    <div
                      key={day}
                      className={`border-b border-[#D8D6CD] px-2 pb-3 ${
                        i === 0 ? "text-[#A45D42]" : ""
                      }`}
                    >
                      <p className="font-display text-sm font-semibold">{day}</p>
                    </div>
                  ))}

                  {/* Time axis (reference labels only) */}
                  <div
                    className="relative border-r border-[#D8D6CD]"
                    style={{ height: timelineHeight }}
                  >
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="absolute right-3 -translate-y-1/2 font-mono text-[10px] text-[#87908A]"
                        style={{ top: (h - HOUR_START) * PIXELS_PER_MINUTE }}
                      >
                        {formatHourLabel(h)}
                      </div>
                    ))}
                  </div>

                  {/* Day columns — each is a continuous vertical timeline */}
                  {DAYS.map((day) => {
                    const dayEntries = layoutDayEntries(
                      schedule.entries.filter((e) => e.day === day)
                    );

                    return (
                      <div
                        key={day}
                        className="relative border-b border-r border-[#E1DFD7]"
                        style={{ height: timelineHeight }}
                      >
                        {/* Hourly reference lines — pass behind blocks, never split them */}
                        {hours.map((h) => (
                          <div
                            key={h}
                            className="pointer-events-none absolute left-0 right-0 border-t border-[#E1DFD7]"
                            style={{ top: (h - HOUR_START) * PIXELS_PER_MINUTE }}
                          />
                        ))}

                        {dayEntries.map((entry) => {
                          const color = subjectColorMap.get(entry.subject) || COLORS[0];
                          const top = (entry.start_minutes - HOUR_START) * PIXELS_PER_MINUTE;
                          const height = Math.max(
                            (entry.end_minutes - entry.start_minutes) * PIXELS_PER_MINUTE,
                            22
                          );
                          const gap = 4;
                          const leftPct = (entry.col / entry.colCount) * 100;
                          const widthPct = 100 / entry.colCount;

                          return (
                            <div
                              key={entry.id}
                              className={`group absolute z-10 overflow-hidden rounded-xl border p-2 shadow-[0_2px_4px_rgba(45,60,50,.08)] ${
                                entry.hidden ? "opacity-50 ring-1 ring-dashed ring-[#C77A68]" : ""
                              } ${color.bg} ${color.text} ${color.border}`}
                              style={{
                                top,
                                height,
                                left: `calc(${leftPct}% + ${gap}px)`,
                                width: `calc(${widthPct}% - ${gap * 2}px)`,
                              }}
                            >
                              <div className="flex items-start justify-between">
                                <p className="font-display text-xs font-bold leading-tight">
                                  {entry.subject} {entry.number}
                                  {entry.hidden && (
                                    <span className="ml-1 text-[8px] font-normal opacity-70">(hidden)</span>
                                  )}
                                </p>
                                <PrivacyToggle entryId={entry.id} initialHidden={entry.hidden} />
                              </div>
                              <p className="mt-0.5 font-mono text-[9px] opacity-75">
                                {entry.start_display}–{entry.end_display}
                              </p>
                              {entry.room && (
                                <p className="mt-1 flex items-center gap-1 font-mono text-[9px] opacity-75">
                                  <MapPin size={9} />
                                  {entry.room}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Legend */}
        {subjects.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {subjects.map((subject) => {
              const color = subjectColorMap.get(subject) || COLORS[0];
              return (
                <div key={subject} className="flex items-center gap-2">
                  <span
                    className={`h-3 w-3 rounded-full ${color.bg} border ${color.border}`}
                  />
                  <span className="text-xs font-semibold text-[#52605C]">
                    {subject}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Upcoming Deadlines */}
        {upcomingTasks.length > 0 && (
          <div className="mt-8 rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
            <div className="flex items-center gap-2 border-b border-[#D8D6CD] px-5 py-4">
              <ListChecks size={14} className="text-[#A991D1]" />
              <h2 className="font-display text-sm font-semibold text-[#214746]">
                Upcoming deadlines
              </h2>
              <span className="rounded-full bg-[#E8E0F5] px-2 py-0.5 text-[10px] font-bold text-[#34264F]">
                {upcomingTasks.length}
              </span>
            </div>
            <div className="divide-y divide-[#E1DFD7]">
              {upcomingTasks.map((task) => {
                const dueAt = task.due_at ? new Date(task.due_at) : null;
                const now = new Date();
                const diffDays = dueAt
                  ? Math.ceil(
                      (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
                    )
                  : null;
                const isOverdue = diffDays !== null && diffDays < 0;
                const isSoon = diffDays !== null && diffDays >= 0 && diffDays <= 2;

                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 px-5 py-3.5"
                  >
                    <div className="shrink-0">
                      {task.group_id ? (
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#D9E7DE] text-[10px] font-bold text-[#286057]">
                          {task.groups?.name?.slice(0, 2).toUpperCase() || "GP"}
                        </div>
                      ) : (
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#F6D486] text-[10px] font-bold text-[#4C3911]">
                          ME
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#214746] truncate">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.group_id && task.groups?.name && (
                          <span className="text-[10px] text-[#87908A]">
                            {task.groups.name}
                          </span>
                        )}
                        {task.profiles?.full_name && task.group_id && (
                          <span className="text-[10px] text-[#B9BDB4]">
                            &middot; {task.profiles.full_name}
                          </span>
                        )}
                      </div>
                    </div>
                    {dueAt && (
                      <div className="shrink-0 text-right">
                        <p
                          className={`font-mono text-[10px] font-semibold ${
                            isOverdue
                              ? "text-[#A14D3F]"
                              : isSoon
                              ? "text-[#A45D42]"
                              : "text-[#87908A]"
                          }`}
                        >
                          {isOverdue
                            ? "Overdue"
                            : diffDays === 0
                            ? "Today"
                            : diffDays === 1
                            ? "Tomorrow"
                            : `In ${diffDays}d`}
                        </p>
                        <p className="text-[10px] text-[#B9BDB4]">
                          {dueAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
            </>
          }
        />
      </div>
    </main>
  );
}

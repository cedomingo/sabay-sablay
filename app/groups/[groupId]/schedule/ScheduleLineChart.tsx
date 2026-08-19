"use client";

import { useMemo, useState } from "react";
import { MapPin, Clock, Flag, CalendarRange } from "lucide-react";
import type { Task } from "@/lib/actions/tasks";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_START = 420; // 7:00 AM, in minutes
const TIME_END = 1080; // 6:00 PM, in minutes
const HOUR_TICKS = [420, 600, 780, 960, 1080]; // 7a, 10a, 1p, 4p, 6p

// One distinct stroke color per lane, cycling if there are more
// members than colors.
const LINE_COLORS = [
  "#DC7C66",
  "#56B9AC",
  "#A991D1",
  "#DDB35A",
  "#6FA8DC",
  "#E294B3",
  "#7EB57A",
  "#C77A68",
];

interface Entry {
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
}

interface MemberEntry {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  entry: Entry;
}

interface Member {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
}

interface Props {
  entries: MemberEntry[];
  members: Member[];
  memberCount: number;
  /** Group tasks/deadlines/events (Batches D & E's task model) to overlay when "Show Tasks" is checked. */
  tasks: Task[];
}

interface MergedBlock {
  user_id: string;
  full_name: string;
  day: string;
  start_minutes: number;
  end_minutes: number;
  start_display: string;
  end_display: string;
  subject: string;
  number: string;
  section: string;
  room: string | null;
}

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

interface TaskMarker {
  task: Task;
  dayIdx: number;
  minutes: number | null; // null = no specific time, centered in the day column
}

interface TaskBarSegment {
  task: Task;
  startCol: number;
  endCol: number;
  lane: number;
}

// end_date comes back as a plain "YYYY-MM-DD" date (no time/zone). Parse
// it as a local date instead of `new Date(str)` (which reads it as UTC
// midnight and can display a day early/late depending on timezone).
function parseDateOnly(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Monday-first date keys for the current real-world week, matching the
// chart's Mon..Sun columns.
function getCurrentWeekKeys(): string[] {
  const today = new Date();
  const mondayIndex = (today.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayIndex);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return dateKey(d);
  });
}

// Multi-day tasks that overlap the visible week, clipped to its Mon..Sun
// columns and packed into lanes so overlapping events stack instead of
// colliding — same approach as the Calendar tab's drag-to-add bars.
function computeTaskBarLanes(
  rangedTasks: Task[],
  weekKeys: string[]
): { segments: TaskBarSegment[]; laneCount: number } {
  const weekStart = weekKeys[0];
  const weekEnd = weekKeys[6];

  const raw: Omit<TaskBarSegment, "lane">[] = [];
  for (const t of rangedTasks) {
    const startKey = dateKey(new Date(t.due_at as string));
    const endKey = t.end_date as string;
    if (endKey < weekStart || startKey > weekEnd) continue;
    const s = startKey < weekStart ? weekStart : startKey;
    const e = endKey > weekEnd ? weekEnd : endKey;
    raw.push({ task: t, startCol: weekKeys.indexOf(s), endCol: weekKeys.indexOf(e) });
  }

  const ordered = [...raw].sort((a, b) => a.startCol - b.startCol);
  const laneEnds: number[] = [];
  const segments: TaskBarSegment[] = ordered.map((seg) => {
    let lane = laneEnds.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(seg.endCol);
    } else {
      laneEnds[lane] = seg.endCol;
    }
    return { ...seg, lane };
  });

  return { segments, laneCount: laneEnds.length };
}

// Merge contiguous entries that belong to the same user, day, and
// subject/section into a single block — so a 3-hour class renders as
// one segment instead of three stacked hourly ones.
function mergeContiguousEntries(entries: MemberEntry[]): MergedBlock[] {
  const groups = new Map<string, MemberEntry[]>();
  for (const e of entries) {
    const key = `${e.user_id}|${e.entry.day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const merged: MergedBlock[] = [];

  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) => a.entry.start_minutes - b.entry.start_minutes
    );

    let current: MergedBlock | null = null;

    for (const item of sorted) {
      const sameClass =
        current &&
        current.subject === item.entry.subject &&
        current.number === item.entry.number &&
        current.section === item.entry.section;
      const contiguous =
        current && item.entry.start_minutes <= current.end_minutes;

      if (current && sameClass && contiguous) {
        current.end_minutes = Math.max(
          current.end_minutes,
          item.entry.end_minutes
        );
        if (item.entry.end_minutes >= current.end_minutes) {
          current.end_display = item.entry.end_display;
        }
      } else {
        if (current) merged.push(current);
        current = {
          user_id: item.user_id,
          full_name: item.full_name,
          day: item.entry.day,
          start_minutes: item.entry.start_minutes,
          end_minutes: item.entry.end_minutes,
          start_display: item.entry.start_display,
          end_display: item.entry.end_display,
          subject: item.entry.subject,
          number: item.entry.number,
          section: item.entry.section,
          room: item.entry.room,
        };
      }
    }
    if (current) merged.push(current);
  }

  return merged;
}

// Layout constants for the tasks overlay lane
const TASK_BAR_LANE_HEIGHT = 17; // px per stacked multi-day event bar
const TASK_BAR_HEIGHT = 13;
const TASK_MARKER_ROW_HEIGHT = 22; // px reserved for single-day task pins
const TASKS_LANE_PADDING = 8; // top+bottom breathing room inside the tasks lane

export default function ScheduleLineChart({
  entries,
  members,
  memberCount,
  tasks,
}: Props) {
  const [showTasks, setShowTasks] = useState(false);
  const [hovered, setHovered] = useState<{
    block: MergedBlock;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredTask, setHoveredTask] = useState<{
    task: Task;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  const blocks = useMemo(() => mergeContiguousEntries(entries), [entries]);

  const weekKeys = useMemo(() => getCurrentWeekKeys(), []);

  const rangedTasks = useMemo(
    () => tasks.filter((t) => t.due_at && t.end_date),
    [tasks]
  );

  const { segments: taskBarSegments, laneCount: taskBarLaneCount } = useMemo(
    () => computeTaskBarLanes(rangedTasks, weekKeys),
    [rangedTasks, weekKeys]
  );

  // Single-day tasks (no end_date) that fall within the visible week,
  // placed by day-of-week and time-of-day (or centered if no time given).
  const taskMarkers = useMemo<TaskMarker[]>(() => {
    const markers: TaskMarker[] = [];
    for (const t of tasks) {
      if (!t.due_at || t.end_date) continue;
      const key = dateKey(new Date(t.due_at));
      const dayIdx = weekKeys.indexOf(key);
      if (dayIdx === -1) continue;
      let minutes: number | null = null;
      if (t.due_time) {
        const [h, m] = t.due_time.split(":").map(Number);
        minutes = h * 60 + m;
      }
      markers.push({ task: t, dayIdx, minutes });
    }
    return markers;
  }, [tasks, weekKeys]);

  const hasTaskOverlay = taskBarSegments.length > 0 || taskMarkers.length > 0;
  const tasksLaneHeight = showTasks
    ? TASKS_LANE_PADDING * 2 +
      Math.max(taskBarLaneCount, 0) * TASK_BAR_LANE_HEIGHT +
      (taskMarkers.length > 0 ? TASK_MARKER_ROW_HEIGHT : 0) +
      (hasTaskOverlay ? 0 : 20) // room for the "no tasks this week" placeholder
    : 0;

  // Layout constants
  const labelWidth = 132;
  const dayWidth = 128;
  const laneHeight = 52;
  const labelHeaderHeight = 32; // fixed area for the Mon/Tue/... weekday labels
  const tasksLaneTop = labelHeaderHeight;
  const headerHeight = labelHeaderHeight + tasksLaneHeight; // offset before member lanes start
  const footerHeight = 24;
  const chartWidth = labelWidth + dayWidth * DAYS.length;
  const chartHeight =
    headerHeight + laneHeight * Math.max(members.length, 1) + footerHeight;

  function dayX(dayIndex: number, minutes: number): number {
    const clamped = Math.min(Math.max(minutes, TIME_START), TIME_END);
    const ratio = (clamped - TIME_START) / (TIME_END - TIME_START);
    return labelWidth + dayIndex * dayWidth + ratio * dayWidth;
  }

  const laneY = (laneIndex: number) =>
    headerHeight + laneIndex * laneHeight + laneHeight - 12;
  const busyY = (laneIndex: number) =>
    headerHeight + laneIndex * laneHeight + 12;

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D8D6CD] px-4 py-4 md:px-6">
          <div>
            <p className="font-display text-lg font-semibold text-[#214746]">
              Group timeline
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
              {memberCount} {memberCount === 1 ? "member" : "members"} ·
              hover a block for details
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Show Tasks checkbox — toggles the tasks/events overlay below, instantly (no round trip) */}
            <label className="flex items-center gap-2 text-xs font-semibold text-[#52605C]">
              <input
                type="checkbox"
                checked={showTasks}
                onChange={(e) => setShowTasks(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[#B9BDB4] accent-[#214746]"
              />
              Show Group Tasks
            </label>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3">
              {members.map((m, i) => (
                <div key={m.user_id} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: LINE_COLORS[i % LINE_COLORS.length],
                    }}
                  />
                  <span className="text-[10px] font-semibold text-[#65716B]">
                    {m.full_name.split(" ")[0]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="overflow-x-auto p-3 md:p-5">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            width={chartWidth}
            height={chartHeight}
            className="select-none"
          >
            {/* Day column separators + labels */}
            {DAYS.map((day, dIdx) => {
              const x0 = labelWidth + dIdx * dayWidth;
              const isWeekend = dIdx >= 5;
              return (
                <g key={day}>
                  {isWeekend && (
                    <rect
                      x={x0}
                      y={0}
                      width={dayWidth}
                      height={chartHeight - footerHeight}
                      fill="#EFEAE0"
                    />
                  )}
                  <line
                    x1={x0}
                    y1={0}
                    x2={x0}
                    y2={chartHeight - footerHeight}
                    stroke="#D8D6CD"
                    strokeWidth={1}
                  />
                  <text
                    x={x0 + dayWidth / 2}
                    y={labelHeaderHeight - 12}
                    textAnchor="middle"
                    className="font-display"
                    fontSize={12}
                    fontWeight={600}
                    fill="#214746"
                  >
                    {day}
                  </text>
                  {/* hour ticks along the bottom of this day column */}
                  {HOUR_TICKS.map((t) => (
                    <text
                      key={t}
                      x={dayX(dIdx, t)}
                      y={chartHeight - 8}
                      textAnchor="middle"
                      fontSize={8}
                      fontFamily="monospace"
                      fill="#87908A"
                    >
                      {formatClock(t).replace(":00", "").replace(" ", "")}
                    </text>
                  ))}
                </g>
              );
            })}
            <line
              x1={chartWidth}
              y1={0}
              x2={chartWidth}
              y2={chartHeight - footerHeight}
              stroke="#D8D6CD"
              strokeWidth={1}
            />

            {/* Tasks & events overlay — toggled instantly by the "Show Tasks" checkbox */}
            {showTasks && (
              <g>
                <line
                  x1={0}
                  y1={headerHeight}
                  x2={chartWidth}
                  y2={headerHeight}
                  stroke="#D8D6CD"
                  strokeWidth={1}
                />
                <text
                  x={8}
                  y={tasksLaneTop + tasksLaneHeight / 2 + 3}
                  fontSize={10}
                  fontWeight={700}
                  fill="#765514"
                >
                  Tasks
                </text>

                {hasTaskOverlay ? (
                  <>
                    {/* Multi-day events as spanning bars, same visual language as the Calendar tab */}
                    {taskBarSegments.map((seg) => {
                      const x1 = dayX(seg.startCol, TIME_START);
                      const x2 = dayX(seg.endCol, TIME_END);
                      const y =
                        tasksLaneTop + TASKS_LANE_PADDING + seg.lane * TASK_BAR_LANE_HEIGHT;
                      const barWidth = Math.max(x2 - x1, 4);
                      const maxChars = Math.max(Math.floor((barWidth - 12) / 5.5), 0);
                      const label =
                        seg.task.title.length > maxChars
                          ? `${seg.task.title.slice(0, Math.max(maxChars - 1, 0))}…`
                          : seg.task.title;

                      return (
                        <g
                          key={seg.task.id}
                          className="cursor-pointer"
                          onMouseEnter={(e) => {
                            const rect = (
                              e.currentTarget as SVGGElement
                            ).getBoundingClientRect();
                            setHoveredTask({
                              task: seg.task,
                              label: "range",
                              x: rect.left + rect.width / 2,
                              y: rect.top,
                            });
                          }}
                          onMouseLeave={() => setHoveredTask(null)}
                        >
                          <rect
                            x={x1}
                            y={y}
                            width={barWidth}
                            height={TASK_BAR_HEIGHT}
                            rx={4}
                            fill="#F6D486"
                            stroke="#DDB35A"
                            strokeWidth={1}
                          />
                          <text
                            x={x1 + 6}
                            y={y + TASK_BAR_HEIGHT - 3}
                            fontSize={9}
                            fontWeight={600}
                            fill="#6B4E13"
                            className="pointer-events-none"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Single-day tasks/deadlines as pins, positioned by due time (or centered) */}
                    {taskMarkers.map((m) => {
                      const minutes = m.minutes ?? (TIME_START + TIME_END) / 2;
                      const x = dayX(m.dayIdx, minutes);
                      const y =
                        tasksLaneTop +
                        TASKS_LANE_PADDING +
                        taskBarLaneCount * TASK_BAR_LANE_HEIGHT +
                        TASK_MARKER_ROW_HEIGHT / 2;

                      return (
                        <g
                          key={m.task.id}
                          className="cursor-pointer"
                          onMouseEnter={(e) => {
                            const rect = (
                              e.currentTarget as SVGGElement
                            ).getBoundingClientRect();
                            setHoveredTask({
                              task: m.task,
                              label: "single",
                              x: rect.left + rect.width / 2,
                              y: rect.top,
                            });
                          }}
                          onMouseLeave={() => setHoveredTask(null)}
                        >
                          <circle
                            cx={x}
                            cy={y}
                            r={5}
                            fill="#A45D42"
                            stroke="#F8F6F0"
                            strokeWidth={1.5}
                          />
                        </g>
                      );
                    })}
                  </>
                ) : (
                  <text
                    x={labelWidth + 8}
                    y={tasksLaneTop + tasksLaneHeight / 2 + 3}
                    fontSize={10}
                    fill="#87908A"
                    fontStyle="italic"
                  >
                    No tasks or events this week
                  </text>
                )}
              </g>
            )}

            {/* Lane baselines + labels */}
            {members.map((m, laneIdx) => (
              <g key={m.user_id}>
                <text
                  x={8}
                  y={laneY(laneIdx) + 4}
                  fontSize={11}
                  fontWeight={600}
                  fill="#214746"
                >
                  {m.full_name.length > 16
                    ? `${m.full_name.slice(0, 15)}…`
                    : m.full_name}
                </text>
              </g>
            ))}

            {/* One line per user, per day, with merged blocks raised */}
            {members.map((m, laneIdx) => {
              const color = LINE_COLORS[laneIdx % LINE_COLORS.length];
              return (
                <g key={m.user_id}>
                  {DAYS.map((day, dIdx) => {
                    const dayBlocks = blocks
                      .filter(
                        (b) => b.user_id === m.user_id && b.day === day
                      )
                      .sort((a, b) => a.start_minutes - b.start_minutes);

                    const free = laneY(laneIdx);
                    const busy = busyY(laneIdx);
                    const xStart = dayX(dIdx, TIME_START);
                    const xEnd = dayX(dIdx, TIME_END);

                    let path = `M ${xStart} ${free}`;
                    for (const b of dayBlocks) {
                      const x1 = dayX(dIdx, b.start_minutes);
                      const x2 = dayX(dIdx, b.end_minutes);
                      path += ` L ${x1} ${free} L ${x1} ${busy} L ${x2} ${busy} L ${x2} ${free}`;
                    }
                    path += ` L ${xEnd} ${free}`;

                    return (
                      <g key={`${m.user_id}-${day}`}>
                        <path
                          d={path}
                          fill="none"
                          stroke={color}
                          strokeWidth={2}
                          strokeLinejoin="round"
                        />
                        {dayBlocks.map((b) => {
                          const x1 = dayX(dIdx, b.start_minutes);
                          const x2 = dayX(dIdx, b.end_minutes);
                          return (
                            <rect
                              key={b.day + b.start_minutes + b.subject}
                              x={x1}
                              y={busy}
                              width={Math.max(x2 - x1, 2)}
                              height={free - busy}
                              fill={color}
                              fillOpacity={0.18}
                              stroke="none"
                              className="cursor-pointer"
                              onMouseEnter={(e) => {
                                const rect = (
                                  e.target as SVGRectElement
                                ).getBoundingClientRect();
                                setHovered({
                                  block: b,
                                  x: rect.left + rect.width / 2,
                                  y: rect.top,
                                });
                              }}
                              onMouseLeave={() => setHovered(null)}
                            />
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border border-[#D0CEC4] bg-[#214746] px-3 py-2 text-[#F4F1E9] shadow-card"
          style={{ left: hovered.x, top: hovered.y - 8 }}
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <Clock size={11} />
            {hovered.block.full_name}
          </p>
          <p className="mt-0.5 text-[11px] text-[#D3E5DC]">
            {hovered.block.subject} {hovered.block.number} ·{" "}
            {hovered.block.start_display}–{hovered.block.end_display}
          </p>
          {hovered.block.room && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#A9D8CA]">
              <MapPin size={9} />
              {hovered.block.room}
            </p>
          )}
        </div>
      )}

      {/* Task/event hover tooltip */}
      {hoveredTask && (
        <div
          className="pointer-events-none fixed z-50 max-w-[220px] -translate-x-1/2 -translate-y-full rounded-xl border border-[#D0CEC4] bg-[#214746] px-3 py-2 text-[#F4F1E9] shadow-card"
          style={{ left: hoveredTask.x, top: hoveredTask.y - 8 }}
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            {hoveredTask.task.end_date ? <CalendarRange size={11} /> : <Flag size={11} />}
            {hoveredTask.task.title}
          </p>
          <p className="mt-0.5 text-[11px] text-[#D3E5DC]">
            {hoveredTask.task.end_date
              ? `${new Date(hoveredTask.task.due_at as string).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })} \u2013 ${parseDateOnly(hoveredTask.task.end_date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}`
              : `${new Date(hoveredTask.task.due_at as string).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}${hoveredTask.task.due_time ? ` \u00b7 ${formatClock(
                  Number(hoveredTask.task.due_time.split(":")[0]) * 60 +
                    Number(hoveredTask.task.due_time.split(":")[1])
                )}` : ""}`}
          </p>
          {hoveredTask.task.description && (
            <p className="mt-0.5 line-clamp-3 text-[10px] text-[#A9D8CA]">
              {hoveredTask.task.description}
            </p>
          )}
          {hoveredTask.task.room && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#A9D8CA]">
              <MapPin size={9} />
              {hoveredTask.task.room}
            </p>
          )}
        </div>
      )}

      {members.length === 0 && (
        <p className="mt-3 text-center text-xs text-[#87908A]">
          No members to show yet.
        </p>
      )}
    </div>
  );
}

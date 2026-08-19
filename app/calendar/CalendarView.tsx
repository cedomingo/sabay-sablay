"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Clock,
  MapPin,
  CalendarRange,
  Trash2,
} from "lucide-react";
import { createPersonalTask, createGroupTask, updateTask, deleteTask, type Task } from "@/lib/actions/tasks";
import { useOptimisticAction } from "@/lib/hooks/use-optimistic-action";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Layout constants shared between the day-cell spacer and the bar
// overlay so the two stay in sync without either knowing about the
// other's implementation.
const BAR_TOP_OFFSET = 32; // px from cell top to first bar lane (below the date badge)
const LANE_HEIGHT = 20; // px per lane (16px bar + 4px gap)
const BAR_HEIGHT = 16; // px

interface CalendarViewProps {
  initialTasks: Task[];
  /**
   * When set, this calendar is a group's Calendar tab: new tasks are
   * created as group tasks (visible to every member, and reflected on
   * each member's personal calendar) instead of personal ones.
   */
  groupId?: string;
}

interface RangedEvent {
  id: string;
  startKey: string;
  endKey: string;
  title: string;
  description: string | null;
}

interface BarSegment {
  id: string;
  startCol: number;
  endCol: number;
  lane: number;
  title?: string;
  description?: string | null;
  isPreview?: boolean;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Always returns 42 dates (6 full weeks), Monday-first, so the grid
// height never jumps between months.
function getMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const mondayIndex = (firstOfMonth.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const gridStart = new Date(year, month, 1 - mondayIndex);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * For one week (7 date keys), figure out which ranged events (plus an
 * optional in-progress drag preview) intersect that week, clip them to
 * the week's columns, and stack overlapping ones into lanes so bars
 * never visually collide.
 */
function computeWeekSegments(
  weekKeys: string[],
  ranged: RangedEvent[],
  preview: { startKey: string; endKey: string } | null
): { segments: BarSegment[]; laneCount: number } {
  const weekStart = weekKeys[0];
  const weekEnd = weekKeys[6];

  type RawSeg = Omit<BarSegment, "lane">;
  const raw: RawSeg[] = [];

  if (preview && preview.endKey >= weekStart && preview.startKey <= weekEnd) {
    const s = preview.startKey < weekStart ? weekStart : preview.startKey;
    const e = preview.endKey > weekEnd ? weekEnd : preview.endKey;
    raw.push({
      id: "__preview__",
      startCol: weekKeys.indexOf(s),
      endCol: weekKeys.indexOf(e),
      isPreview: true,
    });
  }

  for (const r of ranged) {
    if (r.endKey < weekStart || r.startKey > weekEnd) continue;
    const s = r.startKey < weekStart ? weekStart : r.startKey;
    const e = r.endKey > weekEnd ? weekEnd : r.endKey;
    raw.push({
      id: r.id,
      startCol: weekKeys.indexOf(s),
      endCol: weekKeys.indexOf(e),
      title: r.title,
      description: r.description,
    });
  }

  // Preview always claims a lane first (so it doesn't jump around as
  // you drag over/under existing events), then the rest pack left-to-right.
  const ordered = [...raw].sort((a, b) => {
    if (a.isPreview && !b.isPreview) return -1;
    if (!a.isPreview && b.isPreview) return 1;
    return a.startCol - b.startCol;
  });

  const laneEnds: number[] = [];
  const segments: BarSegment[] = ordered.map((seg) => {
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

export default function CalendarView({ initialTasks, groupId }: CalendarViewProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const { run } = useOptimisticAction<Task[]>(setTasks);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const today = new Date();
  const todayKey = dateKey(today);
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  // ---- Single-day task modal (Batch D) ----
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [room, setRoom] = useState("");
  const [description, setDescription] = useState("");

  // ---- Multi-day (ranged) event modal ----
  const [rangeModal, setRangeModal] = useState<{ start: Date; end: Date } | null>(null);
  const [rangeName, setRangeName] = useState("");
  const [rangeDescription, setRangeDescription] = useState("");

  // ---- Task detail / edit modal (Notion-style: click an existing item
  // to open it, fields save inline, no separate "view" vs "edit" mode) ----
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailTime, setDetailTime] = useState("");
  const [detailRoom, setDetailRoom] = useState("");

  // ---- Drag-to-select state ----
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartKey, setDragStartKey] = useState<string | null>(null);
  const [dragCurrentKey, setDragCurrentKey] = useState<string | null>(null);

  // ---- Bar hover tooltip ----
  const [tooltip, setTooltip] = useState<{
    title: string;
    description: string | null;
    x: number;
    y: number;
  } | null>(null);

  const grid = useMemo(
    () => getMonthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  );

  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7)),
    [grid]
  );

  // Single-day tasks (no end_date) render as the little chip list inside
  // each day cell, same as Batch D.
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_at || t.end_date) continue;
      const key = dateKey(new Date(t.due_at));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.due_time || "").localeCompare(b.due_time || ""));
    }
    return map;
  }, [tasks]);

  // Multi-day tasks (has end_date) render as spanning bars via the
  // per-week overlay computed below.
  const rangedEvents = useMemo<RangedEvent[]>(() => {
    return tasks
      .filter((t) => t.due_at && t.end_date)
      .map((t) => ({
        id: t.id,
        startKey: dateKey(new Date(t.due_at as string)),
        endKey: t.end_date as string,
        title: t.title,
        description: t.description,
      }));
  }, [tasks]);

  const previewRange = useMemo(() => {
    if (!isDragging || !dragStartKey || !dragCurrentKey) return null;
    return dragStartKey < dragCurrentKey
      ? { startKey: dragStartKey, endKey: dragCurrentKey }
      : { startKey: dragCurrentKey, endKey: dragStartKey };
  }, [isDragging, dragStartKey, dragCurrentKey]);

  // Finalize the drag on pointer-up anywhere on the page (not just over
  // the calendar), so a drag released outside a cell still resolves.
  useEffect(() => {
    if (!isDragging) return;

    function finish() {
      setIsDragging(false);
      if (dragStartKey && dragCurrentKey) {
        if (dragStartKey === dragCurrentKey) {
          openModalFor(keyToDate(dragStartKey));
        } else {
          const startKey = dragStartKey < dragCurrentKey ? dragStartKey : dragCurrentKey;
          const endKey = dragStartKey < dragCurrentKey ? dragCurrentKey : dragStartKey;
          openRangeModalFor(keyToDate(startKey), keyToDate(endKey));
        }
      }
      setDragStartKey(null);
      setDragCurrentKey(null);
    }

    window.addEventListener("pointerup", finish);
    return () => window.removeEventListener("pointerup", finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, dragStartKey, dragCurrentKey]);

  function handleCellPointerDown(key: string) {
    setIsDragging(true);
    setDragStartKey(key);
    setDragCurrentKey(key);
  }

  function handleCellPointerEnter(key: string) {
    if (!isDragging) return;
    setDragCurrentKey(key);
  }

  // ---- Single-day modal ----
  function openModalFor(date: Date) {
    setSelectedDate(date);
    setName("");
    setTime("");
    setRoom("");
    setDescription("");
  }

  function closeModal() {
    setSelectedDate(null);
  }

  async function handleSave() {
    if (!selectedDate) return;
    const title = name.trim();
    if (!title) return;

    const trimmedRoom = room.trim();
    const trimmedDescription = description.trim();
    const [h, m] = time ? time.split(":").map(Number) : [0, 0];

    const dueDateObj = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      h,
      m
    );
    const dueAt = dueDateObj.toISOString();
    const tempId = `temp-${Date.now()}`;

    // Close + clear the form immediately; the task appears on the
    // calendar right away without waiting on the network round trip.
    closeModal();

    await run({
      apply: (prev) => [
        {
          id: tempId,
          owner_id: "",
          group_id: groupId || null,
          title,
          description: trimmedDescription || null,
          due_at: dueAt,
          status: "open",
          assignee_id: null,
          created_at: new Date().toISOString(),
          room: trimmedRoom || null,
          due_time: time || null,
          end_date: null,
        },
        ...prev,
      ],
      revert: (prev) => prev.filter((t) => t.id !== tempId),
      action: () =>
        groupId
          ? createGroupTask({
              groupId,
              title,
              description: trimmedDescription || undefined,
              dueAt,
              room: trimmedRoom || undefined,
              dueTime: time || undefined,
            })
          : createPersonalTask({
              title,
              description: trimmedDescription || undefined,
              dueAt,
              room: trimmedRoom || undefined,
              dueTime: time || undefined,
            }),
      errorMessage: "Couldn't add that task.",
    });
  }

  // ---- Ranged (multi-day) modal ----
  function openRangeModalFor(start: Date, end: Date) {
    setRangeModal({ start, end });
    setRangeName("");
    setRangeDescription("");
  }

  function closeRangeModal() {
    setRangeModal(null);
  }

  async function handleSaveRange() {
    if (!rangeModal) return;
    const title = rangeName.trim();
    if (!title) return;

    const trimmedDescription = rangeDescription.trim();
    const endKey = dateKey(rangeModal.end);
    const dueAt = new Date(
      rangeModal.start.getFullYear(),
      rangeModal.start.getMonth(),
      rangeModal.start.getDate()
    ).toISOString();
    const tempId = `temp-${Date.now()}`;

    // Same instant-feedback pattern as the single-day form: close and
    // show the bar right away, don't wait on the round trip.
    closeRangeModal();

    await run({
      apply: (prev) => [
        {
          id: tempId,
          owner_id: "",
          group_id: groupId || null,
          title,
          description: trimmedDescription || null,
          due_at: dueAt,
          status: "open",
          assignee_id: null,
          created_at: new Date().toISOString(),
          room: null,
          due_time: null,
          end_date: endKey,
        },
        ...prev,
      ],
      revert: (prev) => prev.filter((t) => t.id !== tempId),
      action: () =>
        groupId
          ? createGroupTask({
              groupId,
              title,
              description: trimmedDescription || undefined,
              dueAt,
              endDate: endKey,
            })
          : createPersonalTask({
              title,
              description: trimmedDescription || undefined,
              dueAt,
              endDate: endKey,
            }),
      errorMessage: "Couldn't add that event.",
    });
  }

  // ---- Task detail / edit modal ----
  function openDetailFor(task: Task) {
    setDetailTask(task);
    setDetailTitle(task.title);
    setDetailDescription(task.description || "");
    setDetailTime(task.due_time || "");
    setDetailRoom(task.room || "");
  }

  function closeDetail() {
    setDetailTask(null);
  }

  // Saves whichever field changed, straight from its onBlur — no
  // separate "Save" step, same as editing a Notion page.
  async function saveDetailField(patch: Partial<Task>) {
    if (!detailTask) return;
    const taskId = detailTask.id;
    const updated = { ...detailTask, ...patch };
    setDetailTask(updated);

    await run({
      id: taskId,
      apply: (prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      action: () =>
        updateTask(taskId, {
          title: patch.title,
          description: patch.description,
          room: patch.room,
          dueTime: patch.due_time,
        }),
      errorMessage: "Couldn't save your changes.",
    });
  }

  async function handleDeleteDetail() {
    if (!detailTask) return;
    const taskId = detailTask.id;
    closeDetail();

    await run({
      id: taskId,
      apply: (prev) => prev.filter((t) => t.id !== taskId),
      action: () => deleteTask(taskId),
      errorMessage: "Couldn't delete that task.",
    });
  }

  function goToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  function showTooltip(e: React.MouseEvent, title: string, description: string | null) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ title, description, x: rect.left + rect.width / 2, y: rect.top });
  }

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-[#214746]">
          {cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="rounded-xl border border-[#C8C6BD] px-3 py-1.5 text-xs font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
          >
            Today
          </button>
          <button
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
            className="grid h-8 w-8 place-items-center rounded-xl border border-[#C8C6BD] text-[#52605C] hover:bg-[#E7EBE5]"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
            className="grid h-8 w-8 place-items-center rounded-xl border border-[#C8C6BD] text-[#52605C] hover:bg-[#E7EBE5]"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
        Tap a day to add a task &middot; drag across days to plan a multi-day event
      </p>

      {/* Grid */}
      <div className="overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
        <div className="grid grid-cols-7 border-b border-[#D8D6CD]">
          {WEEKDAY_LABELS.map((d) => (
            <div
              key={d}
              className="px-2 py-2.5 text-center font-mono text-[10px] uppercase tracking-widest text-[#87908A]"
            >
              {d}
            </div>
          ))}
        </div>

        <div style={{ touchAction: isDragging ? "none" : "pan-y" }}>
          {weeks.map((week, wi) => {
            const weekKeys = week.map(dateKey);
            const { segments, laneCount } = computeWeekSegments(
              weekKeys,
              rangedEvents,
              previewRange
            );
            const spacerHeight = laneCount > 0 ? laneCount * LANE_HEIGHT + 4 : 0;

            return (
              <div key={wi} className="relative select-none">
                <div
                  className={`grid grid-cols-7 ${
                    wi < weeks.length - 1 ? "border-b border-[#E1DFD7]" : ""
                  }`}
                >
                  {week.map((date, di) => {
                    const key = weekKeys[di];
                    const isCurrentMonth = date.getMonth() === cursor.getMonth();
                    const isToday = key === todayKey;
                    const dayTasks = tasksByDate.get(key) || [];
                    const isDragTarget = Boolean(
                      isDragging &&
                        previewRange &&
                        key >= previewRange.startKey &&
                        key <= previewRange.endKey
                    );

                    return (
                      <div
                        key={key}
                        role="button"
                        tabIndex={0}
                        onPointerDown={() => handleCellPointerDown(key)}
                        onPointerEnter={() => handleCellPointerEnter(key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openModalFor(date);
                          }
                        }}
                        className={`schedule-cell flex min-h-[104px] cursor-pointer flex-col items-stretch gap-1 p-2 text-left transition-colors ${
                          di < 6 ? "border-r border-[#E1DFD7]" : ""
                        } ${isCurrentMonth ? "" : "opacity-40"} ${
                          isDragTarget ? "bg-[#DCEEE8]" : ""
                        } ${isToday && !isDragTarget ? "bg-[#EFF6F3]" : ""}`}
                      >
                        <span
                          className={`self-start rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                            isToday
                              ? "bg-[#214746] text-[#F4F1E9] ring-2 ring-[#56B9AC]/40"
                              : "text-[#52605C]"
                          }`}
                        >
                          {date.getDate()}
                        </span>

                        {spacerHeight > 0 && <div style={{ height: spacerHeight }} />}

                        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
                          {dayTasks.slice(0, 3).map((t) => (
                            <span
                              key={t.id}
                              title={t.title}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetailFor(t);
                              }}
                              className="cursor-pointer truncate rounded-md bg-[#D9E7DE] px-1.5 py-0.5 text-[10px] font-semibold text-[#286057] hover:bg-[#C7DBCE]"
                            >
                              {t.due_time ? `${formatTime12h(t.due_time)} · ` : ""}
                              {t.title}
                            </span>
                          ))}
                          {dayTasks.length > 3 && (
                            <span className="text-[10px] font-semibold text-[#87908A]">
                              +{dayTasks.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Multi-day event bars + drag preview, overlaid across this week's columns */}
                {segments.length > 0 && (
                  <div
                    className="pointer-events-none absolute inset-x-0"
                    style={{ top: BAR_TOP_OFFSET }}
                  >
                    {segments.map((seg) => (
                      <div
                        key={seg.id}
                        onPointerDown={seg.isPreview ? undefined : (e) => e.stopPropagation()}
                        onClick={
                          seg.isPreview
                            ? undefined
                            : (e) => {
                                e.stopPropagation();
                                const task = tasks.find((t) => t.id === seg.id);
                                if (task) openDetailFor(task);
                              }
                        }
                        onMouseEnter={
                          seg.isPreview
                            ? undefined
                            : (e) => showTooltip(e, seg.title || "", seg.description ?? null)
                        }
                        onMouseLeave={seg.isPreview ? undefined : () => setTooltip(null)}
                        className={`pointer-events-auto absolute flex items-center truncate rounded-md px-1.5 text-[10px] font-semibold ${
                          seg.isPreview
                            ? "border border-dashed border-[#56B9AC] bg-[#56B9AC]/25 text-[#214746]"
                            : "cursor-pointer bg-[#F6D486] text-[#6B4E13] shadow-sm hover:brightness-95"
                        }`}
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - 6px)`,
                          top: seg.lane * LANE_HEIGHT,
                          height: BAR_HEIGHT,
                        }}
                      >
                        {!seg.isPreview && seg.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bar hover tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-[60] max-w-[220px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-xl border border-[#C8C6BD] bg-[#214746] px-3 py-2 text-[#F4F1E9] shadow-card"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-display text-xs font-semibold">{tooltip.title}</p>
          {tooltip.description && (
            <p className="mt-0.5 line-clamp-3 text-[11px] text-[#A9D8CA]">
              {tooltip.description}
            </p>
          )}
        </div>
      )}

      {/* Add single-day task modal */}
      {selectedDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] p-6 shadow-card"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  New task
                </p>
                <h3 className="mt-0.5 font-display text-lg font-semibold text-[#214746]">
                  {selectedDate.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </h3>
              </div>
              <button
                onClick={closeModal}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Submit lab report"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                    <Clock size={11} />
                    Time (optional)
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                    <MapPin size={11} />
                    Room (optional)
                  </label>
                  <input
                    type="text"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="e.g. Rm 214"
                    className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Description / details
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Any extra details (optional)"
                  rows={5}
                  className="w-full resize-none rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={closeModal}
                className="rounded-xl border border-[#C8C6BD] px-4 py-2.5 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-2.5 text-sm font-semibold text-[#F4F1E9] transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
              >
                <Check size={14} />
                Save task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add multi-day event modal (drag-to-add) */}
      {rangeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={closeRangeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] p-6 shadow-card"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  <CalendarRange size={12} />
                  New multi-day event
                </p>
                <h3 className="mt-0.5 font-display text-lg font-semibold text-[#214746]">
                  {formatDateShort(rangeModal.start)} &ndash; {formatDateShort(rangeModal.end)}
                </h3>
              </div>
              <button
                onClick={closeRangeModal}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Name
                </label>
                <input
                  type="text"
                  value={rangeName}
                  onChange={(e) => setRangeName(e.target.value)}
                  placeholder="e.g. Finish problem set 3"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSaveRange()}
                  className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Description / details
                </label>
                <textarea
                  value={rangeDescription}
                  onChange={(e) => setRangeDescription(e.target.value)}
                  placeholder="What needs to get done over this stretch (optional)"
                  rows={5}
                  className="w-full resize-none rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={closeRangeModal}
                className="rounded-xl border border-[#C8C6BD] px-4 py-2.5 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRange}
                disabled={!rangeName.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-2.5 text-sm font-semibold text-[#F4F1E9] transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
              >
                <Check size={14} />
                Save event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task detail / edit modal — click any placed task to open it.
          Fields save inline on blur, Notion-style, no separate edit mode. */}
      {detailTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={closeDetail}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] p-6 shadow-card"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  {detailTask.end_date ? <CalendarRange size={12} /> : <Clock size={12} />}
                  {detailTask.end_date
                    ? `${formatDateShort(new Date(detailTask.due_at as string))} \u2013 ${formatDateShort(
                        keyToDate(detailTask.end_date)
                      )}`
                    : detailTask.due_at
                    ? new Date(detailTask.due_at).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })
                    : "Task details"}
                </p>
              </div>
              <button
                onClick={closeDetail}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Name
                </label>
                <input
                  type="text"
                  value={detailTitle}
                  onChange={(e) => setDetailTitle(e.target.value)}
                  onBlur={() => {
                    const title = detailTitle.trim();
                    if (title && title !== detailTask.title) {
                      saveDetailField({ title });
                    } else {
                      setDetailTitle(detailTask.title);
                    }
                  }}
                  autoFocus
                  className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                />
              </div>

              {!detailTask.end_date && (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                      <Clock size={11} />
                      Time
                    </label>
                    <input
                      type="time"
                      value={detailTime}
                      onChange={(e) => setDetailTime(e.target.value)}
                      onBlur={() => saveDetailField({ due_time: detailTime || null })}
                      className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                      <MapPin size={11} />
                      Room
                    </label>
                    <input
                      type="text"
                      value={detailRoom}
                      onChange={(e) => setDetailRoom(e.target.value)}
                      onBlur={() => saveDetailField({ room: detailRoom || null })}
                      placeholder="e.g. Rm 214"
                      className="w-full rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  Description / details
                </label>
                <textarea
                  value={detailDescription}
                  onChange={(e) => setDetailDescription(e.target.value)}
                  onBlur={() => saveDetailField({ description: detailDescription.trim() || null })}
                  placeholder="Any extra details (optional)"
                  rows={5}
                  className="w-full resize-none rounded-xl border border-[#C8C6BD] bg-white px-4 py-2.5 text-sm text-[#214746] placeholder:text-[#B9BDB4] focus:border-[#56B9AC] focus:outline-none focus:ring-2 focus:ring-[#56B9AC]/20"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                onClick={handleDeleteDetail}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E3B7AC] px-4 py-2.5 text-sm font-semibold text-[#A14D3F] hover:bg-[#F6E4DF]"
              >
                <Trash2 size={14} />
                Delete
              </button>
              <button
                onClick={closeDetail}
                className="rounded-xl bg-[#214746] px-5 py-2.5 text-sm font-semibold text-[#F4F1E9] transition-all hover:-translate-y-0.5"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

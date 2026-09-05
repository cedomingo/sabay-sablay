"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { SUBJECT_COLORS, buildSubjectColorMap } from "@/lib/map/subjectColors";
import { formatMinutesAsDisplay } from "@/lib/client-ocr/textCleanup";
import { parseCrsScheduleBlocks, expandParsedBlocks } from "@/lib/crs-monitor/matcher";
import TbaLocationPrompt from "./TbaLocationPrompt";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const HOUR_START = 420;
const DEFAULT_HOUR_END = 1020;
const PIXELS_PER_MINUTE = 1.2;

const DAY_FULL_NAME: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const DAY_SORT_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

function getDayIndex(day: string): number {
  const map: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  return map[day] ?? 0;
}

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

function formatHourLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:00 ${period}`;
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
  displayRoom: string | null;
  hidden: boolean;
  enrichment_matched: boolean;
}

interface Props {
  entries: ScheduleEntry[];
  subjectColorMap: Map<string, { bg: string; text: string; border: string }>;
  tbaPromptEntryIds: Set<string>;
  overrides: any[];
  places: any[];
}

export default function PersonalScheduleGrid({ entries, subjectColorMap, tbaPromptEntryIds, overrides, places }: Props) {
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [currentDay, setCurrentDay] = useState<string>("Mon");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      setCurrentDay(dayNames[now.getDay()]);
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const currentMinutes = useMemo(() => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    return hours * 60 + minutes;
  }, [currentTime]);

  const isCurrentEntry = useMemo(() => (entry: ScheduleEntry) => {
    if (entry.day !== currentDay) return false;
    return entry.start_minutes <= currentMinutes && entry.end_minutes > currentMinutes;
  }, [currentDay, currentMinutes]);

  const maxEndMinutes = entries.length
    ? Math.max(...entries.map((e) => e.end_minutes))
    : DEFAULT_HOUR_END;
  const hourEnd = Math.max(DEFAULT_HOUR_END, Math.ceil(maxEndMinutes / 60) * 60);
  const hours: number[] = [];
  for (let h = HOUR_START; h <= hourEnd; h += 60) hours.push(h);
  const timelineHeight = (hourEnd - HOUR_START) * PIXELS_PER_MINUTE;

  return (
    <>
      {/* Mobile view: stacked day cards */}
      <div className="space-y-3 md:hidden">
        {DAYS.map((day) => {
          const dayEntries = [...entries]
            .filter((e) => e.day === day)
            .sort((a, b) => a.start_minutes - b.start_minutes);

          return (
            <div key={day} className="overflow-hidden rounded-[18px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
              <div className="flex items-center justify-between border-b border-[#D8D6CD] px-4 py-3">
                <p className={`font-display text-sm font-semibold ${day === "Mon" ? "text-[#A45D42]" : "text-[#214746]"}`}>
                  {day}
                </p>
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                  {dayEntries.length === 0 ? "Free" : `${dayEntries.length} ${dayEntries.length === 1 ? "class" : "classes"}`}
                </span>
              </div>

              {dayEntries.length === 0 ? (
                <p className="px-4 py-3 text-xs text-[#B9BDB4]">Nothing scheduled</p>
              ) : (
                <div className="divide-y divide-[#E1DFD7]">
                  {dayEntries.map((entry) => {
                    const color = subjectColorMap.get(entry.subject) || SUBJECT_COLORS[0];
                    const isCurrent = isCurrentEntry(entry);

                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center gap-3 px-4 py-3 transition-all duration-300 ${isCurrent ? "ring-2 ring-[#F4A28C] bg-[#FFF3E0]" : ""} ${entry.hidden ? "opacity-50" : ""}`}
                      >
                        <span className={`h-9 w-1.5 shrink-0 rounded-full ${color.bg} ${entry.hidden ? "ring-1 ring-dashed ring-[#C77A68]" : ""} ${isCurrent ? "animate-pulse" : ""}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-sm font-bold text-[#214746]">
                            {entry.subject} {entry.number}
                            {entry.hidden && <span className="ml-1 text-[10px] font-normal opacity-70">(hidden)</span>}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-[#52605C]">
                            {entry.start_display}&ndash;{entry.end_display}
                          </p>
                          {!tbaPromptEntryIds.has(entry.id) && entry.displayRoom && (
                            <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-[#87908A]">
                              <MapPin size={9} />
                              {entry.displayRoom}
                            </p>
                          )}
                          {tbaPromptEntryIds.has(entry.id) && (
                            <TbaLocationPrompt entryId={entry.id} rawRoom={entry.room} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop grid */}
      <div className="hidden overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card md:block">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D8D6CD] px-4 py-4 md:px-6">
          <div>
            <p className="font-display text-lg font-semibold text-[#214746]">
              Week of{" "}
              {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">Personal view</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#65716B]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#F4A28C] animate-pulse" title="Current class" />
            <span className="text-[10px]">current</span>
            <span className="ml-2 h-2.5 w-2.5 rounded-full border border-[#9FB9AE] bg-[#E5EDE6]" /> free
          </div>
        </div>

        <div className="min-w-[720px] overflow-x-auto p-3 md:p-5">
          <div className="grid grid-cols-[74px_repeat(5,minmax(118px,1fr))]">
            <div className="h-12" />
            {DAYS.map((day, i) => (
              <div key={day} className={`border-b border-[#D8D6CD] px-2 pb-3 ${i === 0 ? "text-[#A45D42]" : ""}`}>
                <p className="font-display text-sm font-semibold">{day}</p>
              </div>
            ))}

            <div className="relative border-r border-[#D8D6CD]" style={{ height: timelineHeight }}>
              {hours.map((h) => (
                <div key={h} className="absolute right-3 -translate-y-1/2 font-mono text-[10px] text-[#87908A]" style={{ top: (h - HOUR_START) * PIXELS_PER_MINUTE }}>
                  {formatHourLabel(h)}
                </div>
              ))}
              {/* Current time indicator line */}
              {currentDay && currentMinutes >= HOUR_START && currentMinutes <= hourEnd && (
                <div
                  className="absolute left-0 right-0 h-px bg-[#F4A28C] animate-pulse"
                  style={{ top: (currentMinutes - HOUR_START) * PIXELS_PER_MINUTE }}
                  title={`Now: ${formatHourLabel(currentMinutes)}`}
                />
              )}
            </div>

            {DAYS.map((day) => {
              const dayEntries = layoutDayEntries(entries.filter((e) => e.day === day));

              return (
                <div key={day} className="relative border-b border-r border-[#E1DFD7]" style={{ height: timelineHeight }}>
                  {hours.map((h) => (
                    <div key={h} className="pointer-events-none absolute left-0 right-0 border-t border-[#E1DFD7]" style={{ top: (h - HOUR_START) * PIXELS_PER_MINUTE }} />
                  ))}

                  {currentDay === day && currentMinutes >= HOUR_START && currentMinutes <= hourEnd && (
                    <div
                      className="absolute left-0 right-0 h-px bg-[#F4A28C] animate-pulse"
                      style={{ top: (currentMinutes - HOUR_START) * PIXELS_PER_MINUTE }}
                    />
                  )}

                  {dayEntries.map((entry) => {
                    const color = subjectColorMap.get(entry.subject) || SUBJECT_COLORS[0];
                    const isCurrent = isCurrentEntry(entry);

                    const top = (entry.start_minutes - HOUR_START) * PIXELS_PER_MINUTE;
                    const height = Math.max((entry.end_minutes - entry.start_minutes) * PIXELS_PER_MINUTE, 22);
                    const gap = 4;
                    const leftPct = (entry.col / entry.colCount) * 100;
                    const widthPct = 100 / entry.colCount;

                    return (
                      <div
                        key={entry.id}
                        className={`group absolute z-10 overflow-hidden rounded-xl border p-2 shadow-[0_2px_4px_rgba(45,60,50,.08)] ${color.bg} ${color.text} ${color.border} ${entry.hidden ? "opacity-50 ring-1 ring-dashed ring-[#C77A68]" : ""} ${isCurrent ? "ring-2 ring-[#F4A28C]" : ""}`}
                        style={{ top, height, left: `calc(${leftPct}% + ${gap}px)`, width: `calc(${widthPct}% - ${gap * 2}px)` }}
                      >
                        <div className="flex items-start justify-between">
                          <p className="font-display text-xs font-bold leading-tight">{entry.subject} {entry.number}{entry.hidden && <span className="ml-1 text-[8px] font-normal opacity-70">(hidden)</span>}</p>
                        </div>
                        <p className="mt-0.5 font-mono text-[9px] opacity-75">{entry.start_display}–{entry.end_display}</p>
                        {!tbaPromptEntryIds.has(entry.id) && entry.displayRoom && (
                          <p className="mt-1 flex items-center gap-1 font-mono text-[9px] opacity-75"><MapPin size={9} />{entry.displayRoom}</p>
                        )}
                        {tbaPromptEntryIds.has(entry.id) && <TbaLocationPrompt entryId={entry.id} rawRoom={entry.room} />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-6 flex flex-wrap items-center gap-3 px-4 pb-4 md:px-6">
          {[...subjectColorMap.entries()].map(([subject, color]) => (
            <div key={subject} className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${color.bg} border ${color.border}`} />
              <span className="text-xs font-semibold text-[#52605C]">{subject}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
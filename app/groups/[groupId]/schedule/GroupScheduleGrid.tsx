"use client";

import { useState } from "react";
import { MapPin, Users as UsersIcon } from "lucide-react";
// One fixed color per person, cycling if there are more members than
// swatches, deterministically hashed from user_id. Lives in
// lib/map/personColors.ts (Map feature Phase 2) so the Map tab's avatar
// pins share the exact same per-person color as this grid.
import { getColorForPerson } from "@/lib/map/personColors";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Timeline starts at 7:00 AM (420 minutes since midnight), same as the
// Personal Schedule. Hour marks are reference lines only — blocks are
// positioned by exact minute.
const HOUR_START = 420;
const DEFAULT_HOUR_END = 1020; // 5:00 PM baseline, extended if entries run later
const PIXELS_PER_MINUTE = 1.2; // 72px per hour

function formatHourLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:00 ${period}`;
}

// Lays out a single day's blocks on a continuous timeline. Blocks that
// don't overlap in time each get the full column width; blocks that do
// overlap (whether from the same person or different people) are
// grouped into a cluster and placed side-by-side within it.
function layoutDayBlocks<T extends { start_minutes: number; end_minutes: number }>(
  blocks: T[]
): Array<T & { col: number; colCount: number }> {
  const sorted = [...blocks].sort((a, b) => a.start_minutes - b.start_minutes);
  const result: Array<T & { col: number; colCount: number }> = [];

  let cluster: T[] = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    for (const block of cluster) {
      let col = colEnds.findIndex((end) => end <= block.start_minutes);
      if (col === -1) {
        colEnds.push(block.end_minutes);
        col = colEnds.length - 1;
      } else {
        colEnds[col] = block.end_minutes;
      }
      result.push({ ...block, col, colCount: 0 });
    }
    const colCount = colEnds.length;
    for (let i = result.length - cluster.length; i < result.length; i++) {
      result[i].colCount = colCount;
    }
    cluster = [];
  };

  for (const block of sorted) {
    if (cluster.length === 0 || block.start_minutes < clusterEnd) {
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.end_minutes);
    } else {
      flushCluster();
      cluster = [block];
      clusterEnd = block.end_minutes;
    }
  }
  flushCluster();

  return result;
}

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
}

interface Block {
  id: string;
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
  course_raw: string;
  room: string | null;
}

interface HoveredBlock {
  block: Block;
  x: number;
  y: number;
}

export default function GroupScheduleGrid({ entries, members }: Props) {
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);

  const blocks: Block[] = entries.map((e) => ({
    id: e.entry.id,
    user_id: e.user_id,
    full_name: e.full_name,
    day: e.entry.day,
    start_minutes: e.entry.start_minutes,
    end_minutes: e.entry.end_minutes,
    start_display: e.entry.start_display,
    end_display: e.entry.end_display,
    subject: e.entry.subject,
    number: e.entry.number,
    section: e.entry.section,
    course_raw: e.entry.course_raw,
    room: e.entry.room,
  }));

  const maxEndMinutes = blocks.length
    ? Math.max(...blocks.map((b) => b.end_minutes))
    : DEFAULT_HOUR_END;
  const hourEnd = Math.max(DEFAULT_HOUR_END, Math.ceil(maxEndMinutes / 60) * 60);
  const hours: number[] = [];
  for (let h = HOUR_START; h <= hourEnd; h += 60) hours.push(h);
  const timelineHeight = (hourEnd - HOUR_START) * PIXELS_PER_MINUTE;

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
        {/* Grid Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D8D6CD] px-4 py-4 md:px-6">
          <div>
            <p className="font-display text-lg font-semibold text-[#214746]">
              Group schedule
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
              Weekly view
              <span className="hidden md:inline"> · hover a block for details</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#65716B]">
            <UsersIcon size={12} />
            {members.length} {members.length === 1 ? "member" : "members"}
          </div>
        </div>

        {/* Desktop grid (md+): full timeline, horizontal scroll if narrow.
            On phones this is replaced by the stacked day list below. */}
        <div className="hidden min-w-[860px] overflow-x-auto p-3 md:block md:p-5">
          <div className="grid grid-cols-[74px_repeat(7,minmax(104px,1fr))]">
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
              const dayBlocks = layoutDayBlocks(
                blocks.filter((b) => b.day === day)
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

                  {dayBlocks.map((block) => {
                    const color = getColorForPerson(block.user_id);
                    const verticalGap = 8;

                    const top =
                      (block.start_minutes - HOUR_START) * PIXELS_PER_MINUTE +
                      verticalGap / 2;

                    const height = Math.max(
                      (block.end_minutes - block.start_minutes) * PIXELS_PER_MINUTE -
                        verticalGap,
                      22
                    );
                    const gap = 4;
                    const leftPct = (block.col / block.colCount) * 100;
                    const widthPct = 100 / block.colCount;

                    return (
                      <div
                        key={block.id}
                        className={`group absolute z-10 cursor-pointer overflow-hidden rounded-xl border p-2 shadow-[0_2px_4px_rgba(45,60,50,.08)] ${color.bg} ${color.text} ${color.border}`}
                        style={{
                          top,
                          height,
                          left: `calc(${leftPct}% + ${gap}px)`,
                          width: `calc(${widthPct}% - ${gap * 2}px)`,
                        }}
                        onMouseEnter={(e) => {
                          const rect = (
                            e.currentTarget as HTMLDivElement
                          ).getBoundingClientRect();
                          setHovered({
                            block,
                            x: rect.left + rect.width / 2,
                            y: rect.top,
                          });
                        }}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <p className="truncate font-display text-xs font-bold leading-tight">
                          {block.subject} {block.number}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[9px] opacity-75">
                          {block.full_name}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[9px] opacity-75">
                          {block.start_display}–{block.end_display}
                        </p>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile view (below md): one card per day, every block showing
            its details inline — the desktop grid's hover tooltip doesn't
            exist on touch, so nothing depends on it here. */}
        <div className="md:hidden">
          {DAYS.map((day) => {
            const dayBlocks = [...blocks]
              .filter((b) => b.day === day)
              .sort((a, b) => a.start_minutes - b.start_minutes);

            return (
              <div
                key={day}
                className={`px-4 py-3 ${
                  day !== DAYS[DAYS.length - 1] ? "border-b border-[#E1DFD7]" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className={`font-display text-sm font-semibold ${day === "Mon" ? "text-[#A45D42]" : "text-[#214746]"}`}>
                    {day}
                  </p>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                    {dayBlocks.length === 0
                      ? "Free"
                      : `${dayBlocks.length} ${dayBlocks.length === 1 ? "block" : "blocks"}`}
                  </span>
                </div>

                {dayBlocks.length === 0 ? (
                  <p className="mt-2 text-xs text-[#B9BDB4]">Nothing scheduled</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {dayBlocks.map((block) => {
                      const color = getColorForPerson(block.user_id);
                      return (
                        <div
                          key={block.id}
                          className={`flex items-center gap-3 rounded-xl border p-3 ${color.bg} ${color.text} ${color.border}`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-sm font-bold leading-tight">
                              {block.subject} {block.number}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-[10px] opacity-80">
                              {block.full_name}
                              {block.section ? ` · Section ${block.section}` : ""}
                            </p>
                            <p className="mt-0.5 font-mono text-[10px] opacity-75">
                              {block.start_display}&ndash;{block.end_display}
                              {block.room && (
                                <>
                                  {" · "}
                                  <MapPin size={9} className="inline" />
                                  {` ${block.room}`}
                                </>
                              )}
                            </p>
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
      </div>

      {/* Hover tooltip — Person, Subject/course, Section, Room, Day, Time */}
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 max-w-[240px] -translate-x-1/2 -translate-y-full rounded-xl border border-[#D0CEC4] bg-[#214746] px-3 py-2 text-[#F4F1E9] shadow-card"
          style={{ left: hovered.x, top: hovered.y - 8 }}
        >
          <p className="text-xs font-semibold">{hovered.block.full_name}</p>
          <p className="mt-0.5 text-[11px] text-[#D3E5DC]">
            {hovered.block.course_raw || `${hovered.block.subject} ${hovered.block.number}`}
          </p>
          {hovered.block.section && (
            <p className="mt-0.5 text-[10px] text-[#A9D8CA]">
              Section {hovered.block.section}
            </p>
          )}
          {hovered.block.room && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#A9D8CA]">
              <MapPin size={9} />
              {hovered.block.room}
            </p>
          )}
          <p className="mt-1 text-[10px] text-[#A9D8CA]">
            {hovered.block.day} · {hovered.block.start_display}–{hovered.block.end_display}
          </p>
        </div>
      )}

      {/* Color legend — one swatch per person */}
      {members.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {members.map((m) => {
            const color = getColorForPerson(m.user_id);
            return (
              <div key={m.user_id} className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${color.bg} border ${color.border}`}
                />
                <span className="text-xs font-semibold text-[#52605C]">
                  {m.full_name}
                </span>
              </div>
            );
          })}
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

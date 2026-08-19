"use client";

import { useState } from "react";
import { MapPin, X, Users, Clock, Sparkles } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TIME_LABELS = [
  "7:00 AM",
  "8:00 AM",
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
];

const TIME_START = 420;
const TIME_STEP = 60;

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

interface Props {
  entries: MemberEntry[];
  memberCount: number;
}

// Heatmap shading: 0% busy = light, 100% busy = dark
function getHeatmapStyle(busyCount: number, total: number): string {
  if (total === 0 || busyCount === 0) return "";
  const ratio = busyCount / total;

  // 0 = fully free (light green), 1 = fully busy (deep teal)
  if (ratio <= 0.25) return "bg-[#DFF1EA]";
  if (ratio <= 0.5) return "bg-[#B8DDD0]";
  if (ratio <= 0.75) return "bg-[#7CC4B4]";
  return "bg-[#4DA89A]";
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export default function HeatmapGrid({ entries, memberCount }: Props) {
  const [selectedCell, setSelectedCell] = useState<{
    day: string;
    row: number;
  } | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Build a lookup: day+row -> array of entries overlapping that cell
  function getBusyEntries(day: string, row: number) {
    const rowStart = TIME_START + row * TIME_STEP;
    const rowEnd = rowStart + TIME_STEP;

    return entries.filter(
      (e) =>
        e.entry.day === day &&
        e.entry.start_minutes < rowEnd &&
        e.entry.end_minutes > rowStart
    );
  }

  // Compute best times to meet (slots where 0 members are busy)
  const bestTimes: Array<{ day: string; time: string; row: number }> = [];
  for (let row = 0; row < TIME_LABELS.length; row++) {
    for (const day of DAYS) {
      const busy = getBusyEntries(day, row);
      if (busy.length === 0) {
        bestTimes.push({ day, time: TIME_LABELS[row], row });
      }
    }
  }
  // Limit to top 3
  const topBest = bestTimes.slice(0, 3);

  const selectedBusy = selectedCell
    ? getBusyEntries(selectedCell.day, selectedCell.row)
    : [];

  return (
    <div className="relative">
      {/* Best times callout */}
      {topBest.length > 0 && (
        <div className="mb-6 rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5 shadow-card">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#F6D486]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
              Best times to meet
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {topBest.map((slot, i) => (
              <div
                key={`${slot.day}-${slot.row}`}
                className="flex items-center gap-3 rounded-xl border border-[#B8DDD0] bg-[#DFF1EA] px-4 py-2.5"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#214746] text-[10px] font-bold text-[#F4F1E9]">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#214746]">
                    {slot.day} {slot.time}
                  </p>
                  <p className="text-xs text-[#717972]">Everyone free</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D8D6CD] px-4 py-4 md:px-6">
          <div>
            <p className="font-display text-lg font-semibold text-[#214746]">
              Group heatmap
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
              {memberCount} {memberCount === 1 ? "member" : "members"} · click
              a cell for details
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#65716B]">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-[#D0CEC4] bg-[#F8F6F0]" />
              Free
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-[#DFF1EA]" />
              Light
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-[#B8DDD0]" />
              Some
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-[#7CC4B4]" />
              Most
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-[#4DA89A]" />
              All
            </div>
          </div>
        </div>

        {/* Grid Body */}
        <div className="min-w-[720px] overflow-x-auto p-3 md:p-5">
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

            {/* Time Rows */}
            {TIME_LABELS.map((time, row) => (
              <div key={time} className="contents">
                <div className="h-[74px] border-r border-[#D8D6CD] pr-3 pt-2 text-right font-mono text-[10px] text-[#87908A]">
                  {time}
                </div>
                {DAYS.map((day, col) => {
                  const busyEntries = getBusyEntries(day, row);
                  const busyCount = busyEntries.length;
                  const isSelected =
                    selectedCell?.day === day && selectedCell?.row === row;
                  const heatStyle = getHeatmapStyle(busyCount, memberCount);

                  return (
                    <div
                      key={`${day}-${row}`}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedCell(null);
                          setShowDetail(false);
                        } else {
                          setSelectedCell({ day, row });
                          setShowDetail(busyEntries.length > 0);
                        }
                      }}
                      className={`schedule-cell relative h-[74px] border-b border-r border-[#E1DFD7] p-1.5 cursor-pointer ${
                        isSelected
                          ? "ring-2 ring-inset ring-[#214746] z-10"
                          : ""
                      } ${heatStyle}`}
                    >
                      {busyCount > 0 && (
                        <div className="grain relative z-10 flex h-full flex-col items-center justify-center rounded-xl border border-[#56B9AC]/30 bg-white/40 p-1">
                          <p className="font-display text-lg font-bold text-[#214746]">
                            {busyCount}
                          </p>
                          <p className="font-mono text-[8px] text-[#717972]">
                            {busyCount === memberCount ? "all busy" : "busy"}
                          </p>
                        </div>
                      )}
                      {busyCount === 0 && (
                        <div className="flex h-full items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="rounded-full bg-[#214746]/10 px-2 py-0.5 text-[9px] font-semibold text-[#214746]">
                            free
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detail Panel (below grid when a cell is selected) */}
      {selectedCell && (
        <div className="mt-4 rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#214746] text-[#F4F1E9]">
                <Clock size={16} />
              </div>
              <div>
                <p className="font-display text-sm font-semibold text-[#214746]">
                  {selectedCell.day} at {TIME_LABELS[selectedCell.row]}
                </p>
                <p className="text-xs text-[#87908A]">
                  {selectedBusy.length} of {memberCount} members busy
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedCell(null);
                setShowDetail(false);
              }}
              className="grid h-7 w-7 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
            >
              <X size={14} />
            </button>
          </div>

          {selectedBusy.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[#B8DDD0] bg-[#DFF1EA]/50 p-4 text-center">
              <p className="text-sm font-semibold text-[#286057]">
                Everyone is free!
              </p>
              <p className="mt-1 text-xs text-[#717972]">
                Great time for a group meeting or study session.
              </p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-[#E1DFD7]">
              {selectedBusy.map((be) => (
                <div
                  key={be.entry.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-[#8DDDD0] text-[10px] font-bold text-[#163D3A]">
                      {be.full_name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#214746]">
                        {be.full_name}
                      </p>
                      <p className="text-xs text-[#87908A]">
                        {be.entry.subject} {be.entry.number} ·{" "}
                        {be.entry.start_display}–{be.entry.end_display}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {be.entry.room && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#D9E7DE] px-2 py-0.5 text-[10px] font-semibold text-[#286057]">
                        <MapPin size={9} />
                        {be.entry.room}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

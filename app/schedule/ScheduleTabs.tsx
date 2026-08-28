"use client";

import { useState, type ReactNode } from "react";
import { CalendarRange, CalendarDays, Map as MapIcon } from "lucide-react";

interface ScheduleTabsProps {
  scheduleTab: ReactNode;
  calendarTab: ReactNode;
  mapTab?: ReactNode;
  initialTab?: "schedule" | "calendar" | "map";
}

/**
 * Switches between the personal weekly Schedule (grid view) and the
 * personal Calendar (tasks & events). Both panels are server-rendered
 * up front, so switching tabs never triggers a refetch. Mirrors
 * GroupTabs.tsx, with an initialTab prop so /schedule?tab=calendar
 * can deep-link straight into the calendar view.
 */
export default function ScheduleTabs({
  scheduleTab,
  calendarTab,
  mapTab,
  initialTab = "schedule",
}: ScheduleTabsProps) {
  const [tab, setTab] = useState<"schedule" | "calendar" | "map">(initialTab);

  return (
    <div>
      <div className="mb-6 inline-flex rounded-xl border border-[#C8C6BD] bg-[#F8F6F0] p-1">
        <button
          type="button"
          onClick={() => setTab("schedule")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === "schedule"
              ? "bg-[#214746] text-[#F4F1E9]"
              : "text-[#52605C] hover:bg-[#E7EBE5]"
          }`}
        >
          <CalendarRange size={14} />
          Schedule
        </button>
        <button
          type="button"
          onClick={() => setTab("calendar")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === "calendar"
              ? "bg-[#214746] text-[#F4F1E9]"
              : "text-[#52605C] hover:bg-[#E7EBE5]"
          }`}
        >
          <CalendarDays size={14} />
          Calendar
        </button>
        {mapTab && (
          <button
            type="button"
            onClick={() => setTab("map")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              tab === "map"
                ? "bg-[#214746] text-[#F4F1E9]"
                : "text-[#52605C] hover:bg-[#E7EBE5]"
            }`}
          >
            <MapIcon size={14} />
            Map
          </button>
        )}
      </div>

      <div className={tab === "schedule" ? "block" : "hidden"}>{scheduleTab}</div>
      <div className={tab === "calendar" ? "block" : "hidden"}>{calendarTab}</div>
      {mapTab && <div className={tab === "map" ? "block" : "hidden"}>{mapTab}</div>}
    </div>
  );
}

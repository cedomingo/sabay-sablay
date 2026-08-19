"use client";

import { useState, type ReactNode } from "react";
import { CalendarRange, CalendarDays, Link2, Copy, Check } from "lucide-react";

interface GroupTabsProps {
  scheduleTab: ReactNode;
  calendarTab: ReactNode;
  inviteCode?: string;
  groupName?: string;
  userName?: string;
}

/**
 * Switches between a group's views: the combined weekly Schedule
 * (who's busy/free, Mon–Sun), the group's shared Calendar (tasks & events
 * everyone can see), and an Invite tab for sharing the group link.
 */
export default function GroupTabs({ scheduleTab, calendarTab, inviteCode, groupName, userName }: GroupTabsProps) {
  const [tab, setTab] = useState<"schedule" | "calendar" | "invite">("schedule");
  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    if (!inviteCode) return;
    const url = `${window.location.origin}/join/${inviteCode}`;
    // Bare link only — see CreatedGroupOverlay for why we don't bundle
    // the "invited you to join" sentence into the copied text.
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
        {inviteCode && (
          <button
            type="button"
            onClick={() => setTab("invite")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              tab === "invite"
                ? "bg-[#214746] text-[#F4F1E9]"
                : "text-[#52605C] hover:bg-[#E7EBE5]"
            }`}
          >
            <Link2 size={14} />
            Invite
          </button>
        )}
      </div>

      <div className={tab === "schedule" ? "block" : "hidden"}>{scheduleTab}</div>
      <div className={tab === "calendar" ? "block" : "hidden"}>{calendarTab}</div>
      {inviteCode && (
        <div className={tab === "invite" ? "block" : "hidden"}>
          <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-[#A991D1]" />
              <h3 className="font-display text-lg font-semibold text-[#214746]">
                Invite classmates
              </h3>
            </div>
            <p className="mt-2 text-sm text-[#717972]">
              Share this link with your classmates to have them join this group.
            </p>

            <div className="mt-4 rounded-xl border border-[#C8C6BD] bg-[#F4F1E9] p-4">
              <div className="flex items-center gap-2 text-xs text-[#87908A]">
                <Link2 size={12} />
                <span>Invite link</span>
              </div>
              <div className="mt-2 rounded-lg border border-[#D0CEC4] bg-white px-3 py-2.5">
                <p className="text-xs text-[#87908A]">Let&apos;s track our schedules together!</p>
                <code className="mt-1 block font-mono text-[11px] text-[#87908A]">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/join/${inviteCode}`
                    : `/join/${inviteCode}`}
                </code>
                <p className="mt-1 text-sm font-semibold text-[#214746]">
                  {userName || "Someone"} invited you to join {groupName || "the group"}
                </p>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-4 py-2.5 text-sm font-semibold text-[#F4F1E9] transition-colors hover:bg-[#2B5855]"
                >
                  {copied ? (
                    <>
                      <Check size={14} />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
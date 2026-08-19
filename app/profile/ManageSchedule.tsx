"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload, CalendarDays, AlertCircle, X } from "lucide-react";
import { deleteMySchedule } from "@/lib/actions/profile";
import { toast } from "@/lib/toast";
import type { MyScheduleSummary } from "@/lib/actions/profile";

export default function ManageSchedule({
  schedule,
}: {
  schedule: MyScheduleSummary | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteMySchedule();
      toast.success("Schedule deleted");
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete schedule"
      );
    } finally {
      setDeleting(false);
    }
  }

  if (!schedule) {
    return (
      <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#F6D486] text-[#765514]">
            <CalendarDays size={20} />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold text-[#214746]">
              No schedule uploaded yet
            </h2>
            <p className="mt-1 text-sm text-[#717972]">
              Upload a timetable screenshot to see your week at a glance and
              share it with your groups.
            </p>
            <a
              href="/schedule/upload"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5"
            >
              <Upload size={16} />
              Upload timetable
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#8DDDD0] text-[#163D3A]">
          <CalendarDays size={20} />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-lg font-semibold text-[#214746]">
            {schedule.label || "My schedule"}
          </h2>
          <p className="mt-1 text-sm text-[#717972]">
            {schedule.entryCount}{" "}
            {schedule.entryCount === 1 ? "entry" : "entries"}
            {schedule.total_units ? ` · ${schedule.total_units} units` : ""}
            {" · uploaded "}
            {new Date(schedule.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href="/schedule/upload"
              className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5"
            >
              <Upload size={16} />
              Upload new
            </a>
            <a
              href="/schedule"
              className="inline-flex items-center gap-2 rounded-xl border border-[#C8C6BD] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
            >
              View schedule
            </a>
            <button
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E2B9AE] px-5 py-3 text-sm font-semibold text-[#A14D3F] hover:bg-[#FCE9E3]"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div
            className="w-full max-w-sm rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#FCE9E3] text-[#A14D3F]">
                <AlertCircle size={20} />
              </div>
              <button
                onClick={() => !deleting && setConfirming(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
              >
                <X size={16} />
              </button>
            </div>
            <h3 className="mt-4 font-display text-lg font-semibold text-[#214746]">
              Delete your schedule?
            </h3>
            <p className="mt-1 text-sm text-[#717972]">
              This removes all {schedule.entryCount} uploaded entries. Your
              groups will no longer see your schedule until you upload a new
              one. This can&apos;t be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#A14D3F] px-5 py-3 text-sm font-semibold text-white hover:bg-[#8B4235] disabled:opacity-60"
              >
                {deleting ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Trash2 size={16} />
                )}
                Delete schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Lets a student fix mistakes in their uploaded schedule — mis-scanned
 * room/building codes most of all, but also subject/number/section typos
 * — directly from the Profile tab. Unlike the "Set your spot" TBA
 * override (lib/actions/map.ts), this edits schedule_entries itself, so a
 * corrected room string also fixes how the entry resolves on the Map tab
 * (see resolveEntryLocation in lib/map/resolveLocation.ts).
 *
 * Clicking directly on a room/building label (or its pencil icon) turns it
 * into a text input in place — no separate modal — since that's the
 * single most common correction (a building code CRS/OCR got wrong).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, MapPin, PencilLine } from "lucide-react";
import { updateScheduleEntryField } from "@/lib/actions/schedule";
import { toast } from "@/lib/toast";

export interface CorrectableEntry {
  id: string;
  day: string;
  start_display: string;
  end_display: string;
  subject: string | null;
  number: string | null;
  section: string | null;
  room: string | null;
}

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function ScheduleCorrections({
  entries,
}: {
  entries: CorrectableEntry[];
}) {
  const [expanded, setExpanded] = useState(false);

  const byDay = useMemo(() => {
    const groups = new Map<string, CorrectableEntry[]>();
    for (const e of entries) {
      const list = groups.get(e.day) ?? [];
      list.push(e);
      groups.set(e.day, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.start_display.localeCompare(b.start_display));
    }
    return [...groups.entries()].sort(
      (a, b) => DAY_ORDER.indexOf(a[0]) - DAY_ORDER.indexOf(b[0])
    );
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 md:p-8">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#F6D486] text-[#765514]">
            <PencilLine size={18} />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-[#214746]">
              Fix a mistake in your schedule
            </h2>
            <p className="mt-0.5 text-xs text-[#717972]">
              Wrong room, building, or course code? Correct it here.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-lg border border-[#C8C6BD] px-3 py-1.5 text-xs font-semibold text-[#52605C]">
          {expanded ? "Hide" : "Open"}
        </span>
      </button>

      {expanded && (
        <div className="mt-5 space-y-4 border-t border-[#E1DFD7] pt-5">
          {byDay.map(([day, dayEntries]) => (
            <div key={day}>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                {day}
              </p>
              <div className="space-y-2">
                {dayEntries.map((entry) => (
                  <EntryCorrectionRow key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCorrectionRow({ entry }: { entry: CorrectableEntry }) {
  return (
    <div className="rounded-xl border border-[#D8D6CD] bg-white/60 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <InlineEditableField
          entryId={entry.id}
          field="subject"
          value={entry.subject ?? ""}
          placeholder="Subject"
          display={(v) => (
            <span className="text-sm font-semibold text-[#214746]">
              {v || "—"}
            </span>
          )}
        />
        <InlineEditableField
          entryId={entry.id}
          field="number"
          value={entry.number ?? ""}
          placeholder="Number"
          display={(v) => (
            <span className="text-sm font-semibold text-[#214746]">
              {v || "—"}
            </span>
          )}
        />
        <InlineEditableField
          entryId={entry.id}
          field="section"
          value={entry.section ?? ""}
          placeholder="Section (optional)"
          display={(v) => (
            <span className="text-xs text-[#87908A]">{v}</span>
          )}
        />
        <span className="ml-auto font-mono text-[10px] text-[#87908A]">
          {entry.start_display}–{entry.end_display}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <InlineEditableField
          entryId={entry.id}
          field="room"
          value={entry.room ?? ""}
          placeholder="Room/building — e.g. MB 304, CAL 512"
          display={(v) => (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D6CD] bg-white px-3 py-1.5 text-left hover:bg-[#F4F1E9] transition-colors group">
              <MapPin size={12} className="shrink-0 text-[#87908A]" />
              <span className="font-mono text-xs text-[#52605C]">
                {v || "No room set — click to add one"}
              </span>
            </span>
          )}
        />
      </div>
    </div>
  );
}

function InlineEditableField({
  entryId,
  field,
  value,
  placeholder,
  display,
}: {
  entryId: string;
  field: "subject" | "number" | "section" | "room";
  value: string;
  placeholder: string;
  display: (value: string) => React.ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (draft.trim() === saved.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateScheduleEntryField(entryId, field, draft);
      setSaved(draft.trim());
      setDraft(draft.trim());
      setEditing(false);
      toast.success("Correction saved");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save that correction"
      );
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(saved);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(saved);
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[#F4F1E9]"
        title={`Click to edit ${field}`}
      >
        {display(saved)}
        <Pencil
          size={10}
          className="text-[#B9BDB4] opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        disabled={saving}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") handleCancel();
        }}
        className="min-w-[7rem] rounded-md border border-[#C8C6BD] bg-white px-2 py-1 text-xs text-[#214746] outline-none focus:border-[#56B9AC] disabled:opacity-60"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#214746] text-[#F4F1E9] hover:bg-[#2B5855] disabled:opacity-60"
        title="Save"
      >
        {saving ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#F4F1E9] border-t-transparent" />
        ) : (
          <Check size={11} />
        )}
      </button>
      <button
        type="button"
        onClick={handleCancel}
        disabled={saving}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[#B9BDB4] text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-60"
        title="Cancel"
      >
        <X size={11} />
      </button>
    </span>
  );
}

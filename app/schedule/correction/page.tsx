"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Plus, AlertCircle } from "lucide-react";
import { saveSchedule } from "@/lib/actions/schedule";
import AppHeader from "@/components/AppHeader";

interface ParsedEntry {
  day: string;
  start: string;
  end: string;
  start_minutes: number;
  end_minutes: number;
  course: string;
  subject: string;
  number: string;
  section: string;
}

interface EnrichedEntry extends ParsedEntry {
  crs_class_code: string | null;
  room: string | null;
  available_slots: number | null;
  total_slots: number | null;
  enrichment_matched: boolean;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CorrectionPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [imagePath, setImagePath] = useState("");
  const [totalUnits, setTotalUnits] = useState<number | null>(null);
  // Set when the upload came from a group invite flow — after saving,
  // we send the user to that group's weekly schedule instead of /schedule.
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("parsedSchedule");
    if (!raw) {
      router.push("/schedule/upload");
      return;
    }

    try {
      const data = JSON.parse(raw);
      const parsed: ParsedEntry[] = data.schedule || [];
      // Initialize enrichment fields
      const withEnrichment: EnrichedEntry[] = parsed.map((e) => ({
        ...e,
        crs_class_code: null,
        room: null,
        available_slots: null,
        total_slots: null,
        enrichment_matched: false,
      }));
      setEntries(withEnrichment);
      setImagePath(data.image_path || "");
      setTotalUnits(data.total_units || null);
      setGroupId(data.groupId || null);
    } catch {
      router.push("/schedule/upload");
      return;
    } finally {
      setLoading(false);
    }
  }, [router]);

  function updateEntry(idx: number, field: keyof EnrichedEntry, value: string | number | boolean) {
    setEntries((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e))
    );
  }

  function deleteEntry(idx: number) {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
    setEditingIdx(null);
  }

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      {
        day: "Mon",
        start: "",
        end: "",
        start_minutes: 0,
        end_minutes: 0,
        course: "",
        subject: "",
        number: "",
        section: "",
        crs_class_code: null,
        room: null,
        available_slots: null,
        total_slots: null,
        enrichment_matched: false,
      },
    ]);
    setEditingIdx(entries.length);
  }

  async function handleEnrich() {
    setEnriching(true);
    setError(null);

    try {
      const res = await fetch("/api/schedule/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: entries.map((e) => ({
            subject: e.subject,
            number: e.number,
            section: e.section,
          })),
        }),
      });

      if (!res.ok) {
        throw new Error("Enrichment failed");
      }

      const { enriched } = await res.json();

      // Merge enrichment data back into entries
      setEntries((prev) =>
        prev.map((e, i) => ({
          ...e,
          ...enriched[i],
        }))
      );
    } catch {
      // Non-blocking: enrichment failure doesn't prevent saving
      console.warn("Enrichment failed, continuing without it");
    } finally {
      setEnriching(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      // Run enrichment first (non-blocking)
      await handleEnrich();

      // Then save
      await saveSchedule({
        totalUnits: totalUnits || undefined,
        imagePath,
        entries: entries.map((e) => ({
          day: e.day,
          start_display: e.start,
          end_display: e.end,
          start_minutes: e.start_minutes,
          end_minutes: e.end_minutes,
          subject: e.subject,
          number: e.number,
          section: e.section,
          course_raw: e.course,
          crs_class_code: e.crs_class_code,
          room: e.room,
          available_slots: e.available_slots,
          total_slots: e.total_slots,
          enrichment_matched: e.enrichment_matched,
        })),
      });

      // Clear the parsed data from session storage
      sessionStorage.removeItem("parsedSchedule");

      // If this upload came from a group invite, land straight on that
      // group's weekly schedule instead of the personal one.
      router.push(groupId ? `/groups/${groupId}` : "/schedule");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#F4F1E9]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#214746] border-t-transparent" />
      </main>
    );
  }

  const matchedCount = entries.filter((e) => e.enrichment_matched).length;

  return (
    <main className="min-h-[100dvh] bg-[#F4F1E9]">
      <AppHeader
        maxWidth="max-w-5xl"
        showNotificationBell={false}
        showSignOut={false}
        subtitle={
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#A9D8CA]">
              Review &amp; correct
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Check your parsed entries
            </h1>
          </div>
        }
        headerActions={
          <p className="text-xs text-[#A9D8CA]">
            {entries.length} entries · {matchedCount} matched to CRS
          </p>
        }
      />

      {/* Content */}
      <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
        {entries.length === 0 ? (
          <div className="paper-grid rounded-[22px] border border-[#D0CEC4] p-12 text-center">
            <AlertCircle className="mx-auto text-[#F6D486]" size={32} />
            <h2 className="mt-4 font-display text-xl font-semibold text-[#214746]">
              No entries found
            </h2>
            <p className="mt-2 text-sm text-[#717972]">
              The OCR didn&apos;t detect any schedule entries. Try uploading a
              clearer screenshot.
            </p>
            <button
              onClick={() => router.push(groupId ? `/schedule/upload?groupId=${groupId}` : "/schedule/upload")}
              className="mt-6 rounded-xl bg-[#214746] px-5 py-2.5 text-sm font-semibold text-[#F4F1E9]"
            >
              Upload again
            </button>
          </div>
        ) : (
          <>
            {/* Editable Table */}
            <div className="overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#D8D6CD]">
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        Day
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        Start
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        End
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        Course
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        Subject
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        #
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        Section
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                        Room
                      </th>
                      <th className="w-10 px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, idx) => {
                      const isEditing = editingIdx === idx;
                      return (
                        <tr
                          key={idx}
                          className={`border-b border-[#E1DFD7] transition-colors ${
                            isEditing ? "bg-[#E4F1EA]" : "hover:bg-[#E7EBE5]"
                          }`}
                          onClick={() => !isEditing && setEditingIdx(idx)}
                        >
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <select
                                value={entry.day}
                                onChange={(e) =>
                                  updateEntry(idx, "day", e.target.value)
                                }
                                className="rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {DAYS.map((d) => (
                                  <option key={d} value={d}>
                                    {d}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="font-semibold text-[#214746]">
                                {entry.day}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                value={entry.start}
                                onChange={(e) =>
                                  updateEntry(idx, "start", e.target.value)
                                }
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="text-[#52605C]">
                                {entry.start}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                value={entry.end}
                                onChange={(e) =>
                                  updateEntry(idx, "end", e.target.value)
                                }
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="text-[#52605C]">
                                {entry.end}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                value={entry.course}
                                onChange={(e) =>
                                  updateEntry(idx, "course", e.target.value)
                                }
                                className="w-full min-w-[150px] rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="font-semibold text-[#214746]">
                                {entry.course}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                value={entry.subject}
                                onChange={(e) =>
                                  updateEntry(idx, "subject", e.target.value)
                                }
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="text-[#52605C]">
                                {entry.subject}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                value={entry.number}
                                onChange={(e) =>
                                  updateEntry(idx, "number", e.target.value)
                                }
                                className="w-12 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="text-[#52605C]">
                                {entry.number}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                value={entry.section}
                                onChange={(e) =>
                                  updateEntry(idx, "section", e.target.value)
                                }
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="text-[#52605C]">
                                {entry.section}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {entry.room ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#D9E7DE] px-2 py-0.5 text-xs font-semibold text-[#286057]">
                                {entry.room}
                              </span>
                            ) : (
                              <span className="text-xs text-[#C8C6BD]">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteEntry(idx);
                              }}
                              className="grid h-7 w-7 place-items-center rounded-lg text-[#C77A68] hover:bg-[#FCE9E3]"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Add Entry Button */}
              <div className="border-t border-[#D8D6CD] px-4 py-3">
                <button
                  onClick={addEntry}
                  className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[#C8C6BD] px-3 py-2 text-xs font-semibold text-[#87908A] hover:border-[#56B9AC] hover:text-[#214746]"
                >
                  <Plus size={14} />
                  Add entry
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-[#C77A68] bg-[#FCE9E3] px-4 py-3 text-xs text-[#A14D3F]">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => router.push(groupId ? `/schedule/upload?groupId=${groupId}` : "/schedule/upload")}
                className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5]"
              >
                Upload different file
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleEnrich}
                  disabled={enriching || entries.length === 0}
                  className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-50"
                >
                  {enriching ? "Looking up sections…" : "Look up CRS sections"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || entries.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#214746] px-6 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#F4F1E9] border-t-transparent" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      Confirm &amp; save schedule
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

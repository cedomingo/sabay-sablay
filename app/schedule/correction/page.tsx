"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Plus, AlertCircle } from "lucide-react";
import { saveSchedule } from "@/lib/actions/schedule";
import { parseCrsScheduleBlocks, expandParsedBlocks, extractCrsCourseNumber, OCR_DAY_TO_CRS_CODE, type CrsParsedBlock } from "@/lib/crs-monitor/matcher";
import { formatMinutesAsDisplay } from "@/lib/client-ocr/textCleanup";
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
  // True when this row's day/time still comes from OCR because CRS-Monitor's
  // own `schedule` free-text failed to parse into blocks on an otherwise
  // confident match (see handleEnrich/handleCandidateConfirm). Surfaced in
  // the UI as "needs review" rather than silently trusting OCR time next to
  // CRS-corrected subject/section/room.
  needs_review: boolean;
}

/** Extract just "TBA" or "Arranged" from room strings like "PE TBA" */
function getTbaDisplay(room: string | null | undefined): string | null {
  if (!room) return null;
  const trimmed = room.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "tba" || lower === "arranged") return trimmed;
  const match = lower.match(/\b(tba|arranged)$/);
  if (match) return match[1].toUpperCase();
  return null;
}

/** Builds the key groupOcrEntries()/matchServer use to identify a class:
 *  the raw OCR course text, whitespace/case normalized. Matching removal
 *  and dedup logic against this (not the split subject/number/section
 *  fields) is required because OCR's own splitCourse() can leave those
 *  fields wrong or empty for multi-word subjects — see matcher.ts's file
 *  header — while `course` (the raw text) is always populated and is
 *  exactly what the server re-splits from. */
function rawCourseKey(course: string): string {
  return course.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Summarizes a CrsSection's room(s) for the candidate-picker preview,
 *  before the user has picked (so there's no single "this row's room" yet
 *  — a lec+lab section can have a different room per meeting segment).
 *  Distinct room values, in schedule order, joined with " / "; null if
 *  none parsed. */
function summarizeRooms(section: { schedule: string | null; scheduleBlocksJson: string }): string | null {
  const blocks = parseCrsScheduleBlocks(section.scheduleBlocksJson, section.schedule);
  const rooms: string[] = [];
  for (const block of blocks) {
    if (block.room && !rooms.includes(block.room)) rooms.push(block.room);
  }
  return rooms.length > 0 ? rooms.join(" / ") : null;
}

// "Only show relevant": a candidate option that meets nowhere near the OCR
// group's claimed day/time is noise (e.g. lab rows shown while confirming a
// lecture). Keep options with a CRS block sharing a meeting day AND starting
// within this tolerance of the OCR start; if nothing survives — or the
// section's schedule is unparseable/TBA, so there's nothing to judge by —
// fall back to the full list rather than dead-ending the user.
const OPTION_RELEVANCE_TOLERANCE_MINUTES = 90;

function filterRelevantOptions<T extends { section: { scheduleBlocksJson: string; schedule: string | null } }>(
  scoredOptions: T[],
  dayRows: Array<{ day: string; startMinutes: number }>
): T[] {
  if (!Array.isArray(dayRows) || dayRows.length === 0) return scoredOptions;
  const kept = scoredOptions.filter((scored) => {
    const blocks = parseCrsScheduleBlocks(scored.section.scheduleBlocksJson, scored.section.schedule);
    if (blocks.length === 0) return true;
    return blocks.some((b) =>
      dayRows.some((row) => {
        const code = OCR_DAY_TO_CRS_CODE[row.day];
        if (!code || !b.days.includes(code)) return false;
        return Math.abs(b.startMinutes - row.startMinutes) <= OPTION_RELEVANCE_TOLERANCE_MINUTES;
      })
    );
  });
  return kept.length > 0 ? kept : scoredOptions;
}

// One pickable CRS-section card, shared by the candidates panel and an
// unmatched row's expanded "more results" list. `scored` is a ScoredCandidate
// from /api/schedule/enrich; the real CrsSection fields live on
// scored.section (reading them off `scored` directly used to crash React with
// error #31 — objects aren't valid JSX children).
function SectionOptionButton({ opt, onSelect }: { opt: any; onSelect: () => void }) {
  const optRooms = summarizeRooms(opt);
  return (
    <button
      onClick={onSelect}
      className="w-full rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] p-3 text-left transition-colors hover:border-[#56B9AC] hover:bg-[#E4F1EA]"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[#214746]">
          {opt.section} — {opt.title}
        </span>
        <span className="text-xs font-mono text-[#87908A]">
          {opt.classCode}
        </span>
      </div>
      <div className="mt-1 text-xs text-[#52605C]">
        <span className="font-semibold">Schedule:</span> {opt.schedule}
      </div>
      <div className="mt-1 text-xs text-[#52605C]">
        <span className="font-semibold">Instructor:</span> {opt.instructor || "TBA"}
        {optRooms && (
          <>
            {" "}· <span className="font-semibold">Room:</span> {optRooms}
          </>
        )}
      </div>
      {opt.remarks && (
        <div className="mt-1 text-xs italic text-[#87908A]">
          {opt.remarks}
        </div>
      )}
    </button>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Full names for the read-only block view (e.g. "Tuesday 8:30 - 10:00"),
// matching the CRS-monitor-style grouped display. Editing still uses the
// short DAYS codes above — this is display-only.
const DAY_FULL_NAME: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

const DAY_SORT_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

interface EntryGroup {
  key: string;
  label: string;
  items: Array<{ entry: EnrichedEntry; idx: number }>;
}

/** Groups the flat, one-row-per-meeting-day `entries` array into one block
 *  per class ("Subject Number"), each holding its own day/time rows —
 *  matching CRS-monitor's convention of listing a class once with all its
 *  meeting days underneath, instead of a flat weekly-style row per day.
 *  This only changes how entries are DISPLAYED; the underlying state is
 *  still the same flat array, indexed the same way, so editing/deleting a
 *  line still calls updateEntry/deleteEntry with its original index. */
function groupEntriesByClass(entries: EnrichedEntry[]): EntryGroup[] {
  const groups = new Map<string, EntryGroup>();

  entries.forEach((entry, idx) => {
    const label = `${entry.subject} ${entry.number}`.trim() || entry.course.trim() || "Untitled class";
    const key = label.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push({ entry, idx });
  });

  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      const dayDiff = (DAY_SORT_INDEX[a.entry.day] ?? 99) - (DAY_SORT_INDEX[b.entry.day] ?? 99);
      if (dayDiff !== 0) return dayDiff;
      return (a.entry.start_minutes ?? 0) - (b.entry.start_minutes ?? 0);
    });
  }

  return Array.from(groups.values());
}

export default function CorrectionPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [imagePath, setImagePath] = useState("");
  const [totalUnits, setTotalUnits] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  
  // Phase C: Enrichment state
  const [enrichmentResults, setEnrichmentResults] = useState<{
    matched: any[];
    candidates: any[];
    unmatched: any[];
  } | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  // Unmatched rows whose "Can't find your section? ..." escape hatch is
  // currently expanded, keyed by the row's raw OCR text.
  const [expandedUnmatched, setExpandedUnmatched] = useState<Set<string>>(new Set());

  const entryGroups = useMemo(() => groupEntriesByClass(entries), [entries]);

  // Guards the auto-enrich call below against firing more than once.
  //
  // In dev, reactStrictMode (next.config.js) intentionally mounts this
  // component twice (mount -> cleanup -> mount) to surface effects that
  // aren't idempotent. Without this guard, the effect below ran
  // handleEnrich(withEnrichment) on both mounts with the *same* captured
  // snapshot. handleEnrich's dedup/removal step matches existing rows by
  // rawCourseKey(entry.rawText) against rawCourseKey(e.course) - but a
  // successful match rewrites e.course to CRS's canonical
  // "${subject} ${number}" form (see handleEnrich), which generally does
  // NOT equal the original raw OCR text the second call's rawText is still
  // derived from. So the second call's removal step found nothing to
  // delete and just appended a second, duplicate set of matched rows on
  // top of the first - every enriched section showed up twice.
  //
  // A ref (not state) is required here: it must persist across the
  // Strict Mode remount without itself triggering a re-render/re-run.
  const hasAutoEnriched = useRef(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("parsedSchedule");
    if (!raw) {
      router.push("/schedule/upload");
      return;
    }

    try {
      const data = JSON.parse(raw);
      const parsed: ParsedEntry[] = data.schedule || [];
      const withEnrichment: EnrichedEntry[] = parsed.map((e) => ({
        ...e,
        crs_class_code: null,
        room: null,
        available_slots: null,
        total_slots: null,
        enrichment_matched: false,
        needs_review: false,
      }));
      setEntries(withEnrichment);
      setImagePath(data.image_path || "");
      setTotalUnits(data.total_units || null);
      setGroupId(data.groupId || null);

      // Run the CRS-Monitor lookup automatically, once, right after
      // parsing — before the user has to click "Look up CRS sections"
      // manually. The comment in handleSave() ("we no longer call
      // handleEnrich() here to prevent race conditions") is about not
      // re-triggering enrichment on every save; that reasoning doesn't
      // apply here. Note this effect can still run more than once (e.g.
      // React Strict Mode's dev-only double-mount), which is why
      // hasAutoEnriched guards the call below — see its comment for why a
      // second call with a stale snapshot silently duplicated every
      // matched row instead of erroring. The manual button still works
      // afterward (e.g. after the user edits a row and wants to
      // re-check it).
      if (withEnrichment.length > 0 && !hasAutoEnriched.current) {
        hasAutoEnriched.current = true;
        void handleEnrich(withEnrichment);
      }
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
        needs_review: false,
      },
    ]);
    setEditingIdx(entries.length);
  }

  // Phase C: New Enrich Handler (Overwrites local state wholesale on match)
  //
  // Only rows NOT already confidently matched are sent to
  // /api/schedule/enrich. Rows carrying enrichment_matched: true (from a
  // previous confident match or a manual candidate pick) already got their
  // day/time/room from CRS, so re-sending them would make the server re-fetch
  // the subject's whole section pool from Turso and re-score them for no
  // change in input.
  //
  // Deliberate choice, no dirty tracking: if the user hand-edits an
  // already-matched row via updateEntry() (day/time/course text in place),
  // it is STILL treated as "already matched" and skipped. updateEntry fires
  // per keystroke with no notion of "dirty", so flipping the flag on edit
  // would strip the row's CRS room/slots context and skew the "X matched"
  // header mid-edit, with nothing to restore them until a manual re-check
  // that isn't wired up. Users who want CRS to re-judge an edited row should
  // delete it and re-add it (addEntry() creates rows with
  // enrichment_matched: false, which this handler will send).
  async function handleEnrich(source?: EnrichedEntry[]) {
    const base = source ?? entries;
    if (base.length === 0) return;

    const toLookUp = base.filter((e) => !e.enrichment_matched);

    // Every row is already matched — there is nothing to ask CRS about.
    // Reset the results panels to empty rather than leaving stale ones up:
    // leftover candidate/unmatched cards can only reference classes whose
    // rows have since been deleted or resolved, and keeping them would
    // contradict the "all matched" header. This early path never flips
    // isEnriching on (no spinner flash) and never touches entries.
    if (toLookUp.length === 0) {
      setEnrichmentResults({ matched: [], candidates: [], unmatched: [] });
      setError(null);
      return;
    }

    setIsEnriching(true);
    setError(null);

    try {
      // IMPORTANT: this body must be a real ScheduleEntry per class-row —
      // day/start/end/start_minutes/end_minutes/course/subject/number/section.
      // That's what groupOcrEntries() (called server-side inside
      // matchAllOcrEntries) reads; it keys groups on `course` and builds
      // each group's dayRows from day/start/end/*_minutes. The previous
      // payload here (subject/number/section/course_raw/rawText) omitted
      // `course` entirely, so `entry.course.replace(...)` threw a
      // TypeError server-side on every call — a plain JS exception, not a
      // CrsMonitorError, so the route's inner catch didn't handle it and it
      // fell through to the outer 500 handler. That's why "Look up CRS
      // sections" always failed with the generic message regardless of
      // CRS_MONITOR_TURSO_URL/CRS_MONITOR_TURSO_AUTH_TOKEN / network state.
      const res = await fetch("/api/schedule/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: toLookUp.map((e) => ({
            day: e.day,
            start: e.start,
            end: e.end,
            start_minutes: e.start_minutes,
            end_minutes: e.end_minutes,
            course: e.course,
            subject: e.subject,
            number: e.number,
            section: e.section,
          })),
        }),
      });

      if (!res.ok) {
        throw new Error("Enrichment request failed");
      }

      const data = await res.json();
      // data.matched/candidates/unmatched describe ONLY the toLookUp subset
      // we sent — not all of entries. That's safe below: the removal step
      // keys on rawCourseKey against full local state, and every skipped
      // row's key is absent from the response (its OCR class wasn't sent),
      // so already-matched rows can't be spliced out or overwritten here.
      // The header counts read off entries state directly, not off data.
      setEnrichmentResults(data);

      // Auto-apply confident matches to the local state
      if (data.matched && data.matched.length > 0) {
        setEntries((prev) => {
          const newEntries = [...prev];

          for (const m of data.matched) {
            const { entry, crsSection } = m;
            // `entry` here is an OcrGroupedClass (see matcher.ts): its
            // subject/number/section come from re-splitting the raw OCR
            // text with CRS's own boundary rule, which deliberately
            // disagrees with OCR's own splitCourse() for multi-word
            // subjects (see matcher.ts file header) — exactly the cases
            // this matching exists to fix. Matching removal against the
            // OCR rows' *split* subject/number/section would silently fail
            // to find rows to remove for those cases. Match on the raw
            // course text instead, which both sides derive from.
            const rawKey = rawCourseKey(entry.rawText);

            // 1. Find indices of existing rows for this class to remove them
            const indicesToRemove: number[] = [];
            newEntries.forEach((e, i) => {
              if (rawCourseKey(e.course) === rawKey) {
                indicesToRemove.push(i);
              }
            });

            // 2. Remove old rows (in reverse order to not mess up indices)
            for (let i = indicesToRemove.length - 1; i >= 0; i--) {
              newEntries.splice(indicesToRemove[i], 1);
            }

            // 3. Parse CRS's structured scheduleBlocksJson (paired with
            // room from the `schedule` free text — see
            // parseCrsScheduleBlocks) to get new blocks. If it comes back
            // empty (rare, but real — e.g. an "Arranged"/TBA section with
            // no fixed schedule), fall back to the OCR'd day-rows for time
            // only, and flag the row as needing manual review rather than
            // silently presenting OCR's time as if CRS-confirmed. Room is
            // unknown in that fallback too, for the same reason. Subject/
            // section/class code still come from CRS either way, since a
            // confident match means those specific fields ARE known — it's
            // only time (and room, which depends on it) that's uncertain.
            const parsedBlocks: CrsParsedBlock[] = parseCrsScheduleBlocks(
              crsSection.scheduleBlocksJson,
              crsSection.schedule
            );
            const needsReview = parsedBlocks.length === 0;
            const rowsToInsert = needsReview
              ? entry.dayRows.map((r: { day: string; start: string; end: string; startMinutes: number; endMinutes: number }) => ({
                  day: r.day,
                  start: r.start,
                  end: r.end,
                  start_minutes: r.startMinutes,
                  end_minutes: r.endMinutes,
                  room: null as string | null,
                }))
              : expandParsedBlocks(parsedBlocks).map((row) => ({
                  day: row.day,
                  start: formatMinutesAsDisplay(row.startMinutes),
                  end: formatMinutesAsDisplay(row.endMinutes),
                  start_minutes: row.startMinutes,
                  end_minutes: row.endMinutes,
                  room: row.room ?? null,
                }));

            // 4. Insert new authoritative rows
            const bareNumber = extractCrsCourseNumber(crsSection.course);
            for (const row of rowsToInsert) {
              newEntries.push({
                ...row,
                course: `${crsSection.subject} ${bareNumber}`,
                subject: crsSection.subject,
                number: bareNumber,
                section: crsSection.section,
                crs_class_code: crsSection.classCode,
                available_slots: crsSection.availableSlots,
                total_slots: crsSection.totalSlots,
                enrichment_matched: true,
                needs_review: needsReview,
              });
            }
          }
          return newEntries;
        });
      }
    } catch (err) {
      console.warn("Enrichment failed, continuing without it", err);
      setError("Failed to look up CRS sections. You can still save manually.");
    } finally {
      setIsEnriching(false);
    }
  }

  // Phase C: Handle manual selection from candidates list
  function handleCandidateConfirm(cand: any, opt: any) {
    // Same removal-key and overwrite semantics as handleEnrich's matched
    // path, kept identical on purpose (Phase 4 requires the manual-pick
    // path to behave the same as the auto-matched path).
    const rawKey = rawCourseKey(cand.entry.rawText);

    setEntries((prev) => {
      const newEntries = prev.filter((e) => rawCourseKey(e.course) !== rawKey);

      const parsedBlocks: CrsParsedBlock[] = parseCrsScheduleBlocks(
        opt.scheduleBlocksJson,
        opt.schedule
      );
      const needsReview = parsedBlocks.length === 0;
      const rowsToInsert = needsReview
        ? cand.entry.dayRows.map((r: { day: string; start: string; end: string; startMinutes: number; endMinutes: number }) => ({
            day: r.day,
            start: r.start,
            end: r.end,
            start_minutes: r.startMinutes,
            end_minutes: r.endMinutes,
            room: null as string | null,
          }))
        : expandParsedBlocks(parsedBlocks).map((row) => ({
            day: row.day,
            start: formatMinutesAsDisplay(row.startMinutes),
            end: formatMinutesAsDisplay(row.endMinutes),
            start_minutes: row.startMinutes,
            end_minutes: row.endMinutes,
            room: row.room ?? null,
          }));

      // `opt` is a CrsSection (see types.ts): `.course` already includes
      // the subject ("Math 23", not "23" — see extractCrsCourseNumber's
      // doc comment), so re-split it the same way handleEnrich's
      // auto-match path does rather than duplicating the subject.
      const bareNumber = extractCrsCourseNumber(opt.course);
      for (const row of rowsToInsert) {
        newEntries.push({
          ...row,
          course: `${opt.subject} ${bareNumber}`,
          subject: opt.subject,
          number: bareNumber,
          section: opt.section,
          crs_class_code: opt.classCode,
          available_slots: opt.availableSlots,
          total_slots: opt.totalSlots,
          enrichment_matched: true,
          needs_review: needsReview,
        });
      }

      // Remove this candidate from the UI state — whether it was offered in
      // the candidates panel or picked through an unmatched row's "more
      // results" expansion (both lists are keyed the same way, so a pick
      // clears it from wherever it was showing).
      setEnrichmentResults((prevRes) => {
        if (!prevRes) return null;
        return {
          matched: prevRes.matched,
          candidates: prevRes.candidates.filter(
            (c) => rawCourseKey(c.entry.rawText) !== rawKey
          ),
          unmatched: prevRes.unmatched.filter(
            (u) => rawCourseKey(u.entry.rawText) !== rawKey
          ),
        };
      });

      return newEntries;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      // Note: We no longer call handleEnrich() here to prevent race conditions.
      // The user should explicitly click "Look up CRS sections" first, review, then save.
      
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

      sessionStorage.removeItem("parsedSchedule");
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
  const needsReviewCount = entries.filter((e) => e.needs_review).length;
  // Rows handleEnrich() would still send — matched rows are skipped, so this
  // is what "Look up CRS sections" has left to work on.
  const unmatchedCount = entries.length - matchedCount;

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
            {needsReviewCount > 0 && ` · ${needsReviewCount} need time review`}
          </p>
        }
      />

      <div className="mx-auto max-w-5xl px-4 py-6 md:px-10 md:py-8">
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
            {/* Grouped-by-class blocks — one card per subject/course, each
                listing its meeting days underneath (CRS-monitor convention),
                instead of one flat row-per-day table. */}
            <div className="space-y-4">
              {entryGroups.map((group) => (
                <div
                  key={group.key}
                  className="overflow-hidden rounded-[22px] border border-[#C8C6BD] bg-[#F8F6F0] shadow-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D8D6CD] px-4 py-3 md:px-6">
                    <h3 className="font-display text-base font-semibold text-[#214746]">
                      {group.label}
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
                      {group.items.length} {group.items.length === 1 ? "meeting" : "meetings"}
                    </span>
                  </div>

                  <div>
                    {group.items.map(({ entry, idx }) => {
                      const isEditing = editingIdx === idx;
                      return (
                        <div
                          key={idx}
                          className={`border-b border-[#E1DFD7] px-4 py-3 last:border-b-0 transition-colors md:px-6 ${
                            isEditing
                              ? "bg-[#E4F1EA]"
                              : entry.needs_review
                              ? "bg-[#FFFDF5] hover:bg-[#FCF6E3]"
                              : "hover:bg-[#E7EBE5]"
                          }`}
                          onClick={() => !isEditing && setEditingIdx(idx)}
                        >
                          {isEditing ? (
                            <div
                              className="flex flex-wrap items-center gap-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <select
                                value={entry.day}
                                onChange={(e) => updateEntry(idx, "day", e.target.value)}
                                className="rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                              >
                                {DAYS.map((d) => (
                                  <option key={d} value={d}>{d}</option>
                                ))}
                              </select>
                              <input
                                value={entry.start}
                                onChange={(e) => updateEntry(idx, "start", e.target.value)}
                                placeholder="Start"
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                              />
                              <span className="text-[#87908A]">–</span>
                              <input
                                value={entry.end}
                                onChange={(e) => updateEntry(idx, "end", e.target.value)}
                                placeholder="End"
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                              />
                              <input
                                value={entry.course}
                                onChange={(e) => updateEntry(idx, "course", e.target.value)}
                                placeholder="Course"
                                className="min-w-[150px] flex-1 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                              />
                              <input
                                value={entry.subject}
                                onChange={(e) => updateEntry(idx, "subject", e.target.value)}
                                placeholder="Subject"
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                              />
                              <input
                                value={entry.number}
                                onChange={(e) => updateEntry(idx, "number", e.target.value)}
                                placeholder="#"
                                className="w-14 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                              />
                              <input
                                value={entry.section}
                                onChange={(e) => updateEntry(idx, "section", e.target.value)}
                                placeholder="Section"
                                className="w-20 rounded-lg border border-[#C8C6BD] bg-[#F4F1E9] px-2 py-1 text-sm"
                              />
                              <button
                                onClick={() => deleteEntry(idx)}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#C77A68] hover:bg-[#FCE9E3]"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-3">
                                <span className="w-24 font-semibold text-[#214746]">
                                  {DAY_FULL_NAME[entry.day] ?? entry.day}
                                </span>
                                <span className="font-mono text-xs text-[#52605C]">
                                  {entry.start} - {entry.end}
                                </span>
                                {entry.section && (
                                  <span className="text-xs text-[#87908A]">
                                    Section {entry.section}
                                  </span>
                                )}
                                {entry.needs_review && (
                                  <span
                                    title="CRS Sections matched this class but its schedule text didn't parse — please verify the day/time"
                                    className="inline-flex items-center rounded-full bg-[#F6D486] px-2 py-0.5 text-[10px] font-semibold text-[#5A4419]"
                                  >
                                    Verify time
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {entry.room ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#D9E7DE] px-2 py-0.5 text-xs font-semibold text-[#286057]">
                                    {getTbaDisplay(entry.room) ?? entry.room}
                                  </span>
                                ) : null}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteEntry(idx);
                                  }}
                                  className="grid h-7 w-7 place-items-center rounded-lg text-[#C77A68] hover:bg-[#FCE9E3]"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <button
                onClick={addEntry}
                className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[#C8C6BD] bg-[#F8F6F0] px-4 py-3 text-xs font-semibold text-[#87908A] hover:border-[#56B9AC] hover:text-[#214746]"
              >
                <Plus size={14} />
                Add entry
              </button>
            </div>

            {/* Phase C: Enrichment Results UI */}
            {enrichmentResults && (
              <div className="mt-8 space-y-6">
                {/* Candidates */}
                {enrichmentResults.candidates.length > 0 && (
                  <div className="rounded-[22px] border border-[#F6D486] bg-[#FFFDF5] p-6 shadow-card">
                    <h3 className="mb-4 font-display text-lg font-semibold text-[#214746]">
                      Multiple matches found — please confirm
                    </h3>
                    <div className="space-y-4">
                      {enrichmentResults.candidates.map((cand: any) => {
                        // Only show relevant options (see
                        // filterRelevantOptions): sections whose meeting
                        // day/time can't plausibly be this row's are hidden.
                        const options = filterRelevantOptions(
                          cand.candidates ?? [],
                          cand.entry?.dayRows ?? []
                        );
                        return (
                        <div key={cand.entry.rawText} className="rounded-xl border border-[#E1DFD7] bg-[#F8F6F0] p-4">
                          <p className="mb-3 text-sm font-semibold text-[#52605C]">
                            {cand.entry.subject} {cand.entry.number} (Section {cand.entry.section || "N/A"})
                          </p>
                          <div className="space-y-2">
                            {options.map((scored: any) => {
                              const opt = scored.section;
                              return (
                                <SectionOptionButton
                                  key={opt.classCode}
                                  opt={opt}
                                  onSelect={() => handleCandidateConfirm(cand, opt)}
                                />
                              );
                            })}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Unmatched */}
                {enrichmentResults.unmatched.length > 0 && (
                  <div className="rounded-[22px] border border-[#C77A68] bg-[#FCE9E3] p-6 shadow-card">
                    <h3 className="mb-4 font-display text-lg font-semibold text-[#A14D3F]">
                      No confident matches found
                    </h3>
                    <p className="mb-4 text-sm text-[#A14D3F]">
                      Please review and manually correct the following entries in the table above:
                    </p>
                    <div className="space-y-2">
                      {enrichmentResults.unmatched.map((unm: any, uIdx: number) => {
                        const unmKey = unm.entry?.rawText ?? `unmatched-${uIdx}`;
                        // Escape hatch: when matching failed (bad parser
                        // split, over-strict filters, wrong subject), the
                        // route still returns the full scored same-course
                        // pool as `options` when it has one. Collapsed by
                        // default; expanding reuses the candidate-picker
                        // cards so the user can pick manually. Rows with no
                        // pool (subject itself unresolvable) show reason
                        // only — there is genuinely nothing more to list.
                        const extraOptions: any[] = Array.isArray(unm.options)
                          ? unm.options
                          : [];
                        const relevantExtra = filterRelevantOptions(
                          extraOptions,
                          unm.entry?.dayRows ?? []
                        );
                        const isExpanded = expandedUnmatched.has(unmKey);
                        return (
                        <div key={unmKey} className="rounded-lg border border-[#E1DFD7] bg-[#F8F6F0] p-3 text-sm">
                          <span className="font-semibold text-[#214746]">
                            {unm.entry.subject} {unm.entry.number}
                          </span>
                          <span className="mx-2 text-[#87908A]">|</span>
                          <span className="text-[#52605C]">Section: {unm.entry.section || "N/A"}</span>
                          <span className="mx-2 text-[#87908A]">|</span>
                          <span className="text-xs text-[#A14D3F]">Reason: {unm.reason}</span>
                          {relevantExtra.length > 0 && !isExpanded && (
                            <button
                              onClick={() =>
                                setExpandedUnmatched((prev) => new Set(prev).add(unmKey))
                              }
                              className="mt-2 block w-full rounded-lg border border-dashed border-[#C77A68] px-3 py-2 text-left text-xs font-semibold text-[#A14D3F] transition-colors hover:bg-[#FFFDF5]"
                            >
                              Can&apos;t find your section? Click here for more results.
                            </button>
                          )}
                          {isExpanded && (
                            <div className="mt-3 space-y-2">
                              {relevantExtra.map((scored: any) => {
                                const opt = scored.section;
                                return (
                                  <SectionOptionButton
                                    key={opt.classCode}
                                    opt={opt}
                                    onSelect={() => {
                                      handleCandidateConfirm(unm, opt);
                                      setExpandedUnmatched((prev) => {
                                        const next = new Set(prev);
                                        next.delete(unmKey);
                                        return next;
                                      });
                                    }}
                                  />
                                );
                              })}
                              <button
                                onClick={() =>
                                  setExpandedUnmatched((prev) => {
                                    const next = new Set(prev);
                                    next.delete(unmKey);
                                    return next;
                                  })
                                }
                                className="text-xs font-semibold text-[#52605C] underline"
                              >
                                Hide extra results
                              </button>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-[#C77A68] bg-[#FCE9E3] px-4 py-3 text-xs text-[#A14D3F]">
                {error}
              </div>
            )}

            {/* Actions — stacks full-width on phones, row on sm+ */}
            <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() => router.push(groupId ? `/schedule/upload?groupId=${groupId}` : "/schedule/upload")}
                className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5] sm:w-auto"
              >
                Upload different file
              </button>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  onClick={() => handleEnrich()}
                  disabled={isEnriching || unmatchedCount === 0}
                  title="Looks up CRS sections for rows not yet matched; already-matched rows are left untouched"
                  className="rounded-xl border border-[#B9BDB4] px-5 py-3 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-50 sm:w-auto"
                >
                  {isEnriching
                    ? "Looking up sections…"
                    : matchedCount > 0 && unmatchedCount > 0
                    ? `Look up CRS sections (${unmatchedCount} left)`
                    : "Look up CRS sections"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || entries.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#214746] px-6 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto"
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
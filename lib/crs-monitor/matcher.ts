// Matches OCR'd schedule rows (from lib/client-ocr) against CRS-Monitor
// sections fetched via ./client.
//
// ---------------------------------------------------------------------------
// Ground truth this file is built against (see crs-enrichment-build-plan.md
// and CRS-Monitor's server/scraper/parser.js — read directly, not assumed):
//
// 1. subject/course/section splitting
//    CRS-Monitor's own splitClassName() (parser.js) splits a "Class" cell
//    like "App Physics 101 THL" using ONE rule: walk the whitespace-split
//    tokens, the course NUMBER is the first token matching /^\d+(\.\d+)?$/,
//    everything before it is the subject (however many words), everything
//    after is the section (with an "and <number>" extension for combined
//    course numbers like "CWTS 1 and 2").
//
//    sabay-sablay's own splitCourse() (lib/client-ocr/textCleanup.ts) uses
//    a DIFFERENT rule: /^([A-Za-z]+)\s*([0-9]+[A-Za-z]?)\s*(.*)$/ — a single
//    unbroken run of letters for the subject. For a single-word subject
//    ("BIO 101 ABC") this happens to agree with CRS's rule. For a
//    multi-word subject it doesn't even match: the regex requires digits
//    immediately (mod whitespace) after the first letter-run, and
//    "Physics"/"Stud" aren't digits, so the whole match fails and
//    splitCourse() falls through to dumping the entire raw string into
//    `subject` with `number`/`section` both empty.
//
//    Confirmed against real fixture data (not the earlier "Anthro/Archaeo"
//    guess, which was wrong): CRS-Monitor's actual multi-word subjects are
//    "App Physics" and "Art Stud". Both trip the sabay-sablay bug.
//
//    Because of this, this matcher does NOT trust OCR's pre-split
//    subject/number/section fields. It re-splits the raw OCR text itself
//    with `reSplitRawCourseText()` below, which mirrors CRS's own boundary
//    rule exactly. This turns "abbreviation mismatch" from something we'd
//    paper over with a hardcoded alias table into something that just
//    doesn't happen — a multi-word subject re-split with CRS's own rule
//    produces CRS's own spelling, mod case/whitespace, which is all
//    normalizeSubject() below has to account for.
//
// 2. section fragment vs classCode
//    OCR's `section` (once correctly re-split) is CRS's short letter
//    fragment (e.g. "WFV"), which must be matched against CrsSection.section
//    — never .classCode (CRS's own registration code, unrelated). The
//    screenshot itself can truncate this fragment, so it's matched as a
//    segment/prefix, not exact equality.
//
// 3. day-row grouping
//    lib/client-ocr's ScheduleEntry is one row PER MEETING DAY (already
//    merged across contiguous same-day OCR rows in parseSchedule.ts, but
//    NOT across days — a TTh lecture is 2 separate ScheduleEntry objects
//    with the same `course` raw text). groupOcrEntries() below groups those
//    into one class before matching, per the locked decision in the build
//    plan (match once per class, not once per day-row).
//
// 4. scheduleBlocks
//    The live GET /api/sections response has no `scheduleBlocks` (only
//    CRS-Monitor's own DB does) — just free-text `schedule`
//    (e.g. "TTh 1-2:30PM lec Rm", possibly multiple ";"-separated segments
//    for lec+lab). parseScheduleText() below is a client-side port of
//    parser.js's parseScheduleBlocks/parseDayTokens/parseTimeRange, used
//    only as a secondary disambiguating signal (see confidence model).
// ---------------------------------------------------------------------------

import type { ScheduleEntry } from "../client-ocr/types";

// NOTE: this file must stay free of any import from "./turso" (or
// anything that transitively imports it). It's imported directly by
// app/schedule/correction/page.tsx, a "use client" component — pulling in
// ./turso would bundle CRS-Monitor's server-only libsql client (and its
// lazy CRS_MONITOR_TURSO_URL/CRS_MONITOR_TURSO_AUTH_TOKEN check) into the
// browser, which throws at import time and crashes the whole page before
// it can render anything. Server-only matching logic that does need
// ./turso lives in ./matchServer instead.

// ===========================================================================
// 1. Re-splitting raw OCR text with CRS's own boundary rule
// ===========================================================================

export interface ReSplitCourseText {
  subject: string;
  number: string;
  section: string;
}

/**
 * Mirrors CRS-Monitor's splitClassName() (parser.js) exactly: the course
 * number is the first token matching /^\d+(\.\d+)?$/; everything before it
 * is the subject (however many words); everything after — extended past an
 * "and <number>" sequence for combined course numbers — is the section.
 *
 * Deliberately NOT the same regex as sabay-sablay's splitCourse(): that one
 * only matches a single-word subject glued directly to a leading digit run,
 * which is exactly the shape that fails on "App Physics 101 THL" /
 * "Art Stud 299 TDEF". We re-derive from the raw OCR text instead of
 * trusting ScheduleEntry.subject/number/section, which may already be
 * wrong for those cases.
 */
export function reSplitRawCourseText(raw: string): ReSplitCourseText {
  const tokens = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (tokens.length < 2) {
    return { subject: tokens[0] ?? "", number: "", section: "" };
  }

  const numberIdx = tokens.findIndex((t) => /^\d+(\.\d+)?$/.test(t));

  if (numberIdx === -1 || numberIdx === 0) {
    // No confident number token (or it's the very first token, so there's
    // no subject in front of it) — fall back to CRS's own fallback
    // heuristic: first token = subject, second = number.
    const subject = tokens[0] ?? "";
    const number = tokens[1] ?? "";
    const section = tokens.slice(2).join(" ");
    return { subject, number, section };
  }

  const subject = tokens.slice(0, numberIdx).join(" ");

  let courseEndIdx = numberIdx;
  while (
    tokens[courseEndIdx + 1] &&
    /^and$/i.test(tokens[courseEndIdx + 1]) &&
    tokens[courseEndIdx + 2] &&
    /^\d+(\.\d+)?$/.test(tokens[courseEndIdx + 2])
  ) {
    courseEndIdx += 2;
  }

  const number = tokens.slice(numberIdx, courseEndIdx + 1).join(" ");
  const section = tokens.slice(courseEndIdx + 1).join(" ");
  return { subject, number, section };
}

/** Case/whitespace normalization only — see file header for why no alias
 *  table is needed once re-splitting uses CRS's own boundary rule. */
export function normalizeSubject(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// normalizeSection() stays in ./matchServer — it's only used by the
// CRS-matching/scoring code that lives there now.

/**
 * Pulls the number token(s) out of a CRS `course` string (e.g.
 * "Art Stud 299" -> "299", "CWTS 1 and 2" -> "1 and 2"). CRS-Monitor's
 * `course` column already includes the subject (confirmed real schema:
 * "Math 23", not just "23" — see the file header's splitClassName note),
 * so this re-splits it with the same boundary rule reSplitRawCourseText()
 * uses, rather than assuming `course` is already bare.
 *
 * Lives here (not ./matchServer) despite being CRS-specific: it's pure
 * text parsing with no dependency on ./turso, and correction/page.tsx (a
 * "use client" component, which cannot import ./matchServer — see that
 * file's own import-boundary comment) needs it too, to fix the
 * "Math Math 23" duplicate-subject bug in its CRS-section-to-entry
 * mapping. ./matchServer re-exports/reuses this exact function for its
 * own course-number filtering rather than keeping a separate copy.
 */
export function extractCrsCourseNumber(crsCourse: string): string {
  return reSplitRawCourseText(crsCourse).number;
}

// ===========================================================================
// 2. Grouping OCR's per-day-row entries into one class
// ===========================================================================

export interface OcrDayRow {
  day: string; // ScheduleEntry.day, e.g. "Mon", "Tue" (full names from OCR)
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
}

export interface OcrGroupedClass {
  /** Raw OCR text shared by this class's day-rows (ScheduleEntry.course). */
  rawText: string;
  subject: string;
  number: string;
  section: string;
  dayRows: OcrDayRow[];
}

/**
 * Groups ScheduleEntry rows (one per meeting day) into one class per
 * distinct raw OCR text, then re-splits that text with CRS's rule.
 *
 * Grouping key is the cleaned raw text, not OCR's own subject/number/
 * section fields (unreliable for multi-word subjects — see file header).
 * Known limitation, flagged rather than silently handled: if the OCR
 * engine reads the *same* class's text slightly differently across two
 * day cells (e.g. a digit misread), this will split one real class into
 * two groups instead of one. Nothing in scope here corrects for that; it
 * would need fuzzy dedup across rawText values, which the build plan
 * doesn't ask for and which risks silently merging two genuinely
 * different classes instead.
 */
export function groupOcrEntries(entries: ScheduleEntry[]): OcrGroupedClass[] {
  const groups = new Map<string, OcrGroupedClass>();

  for (const entry of entries) {
    const key = entry.course.replace(/\s+/g, " ").trim().toLowerCase();
    let group = groups.get(key);
    if (!group) {
      const { subject, number, section } = reSplitRawCourseText(entry.course);
      group = { rawText: entry.course, subject, number, section, dayRows: [] };
      groups.set(key, group);
    }
    group.dayRows.push({
      day: entry.day,
      start: entry.start,
      end: entry.end,
      startMinutes: entry.start_minutes,
      endMinutes: entry.end_minutes,
    });
  }

  return Array.from(groups.values());
}

// ===========================================================================
// 3. Parsing CRS's free-text `schedule` into day/time blocks (client side —
//    the live API doesn't return scheduleBlocks, only CRS-Monitor's own DB
//    has that). Ported from parser.js's parseScheduleBlocks/parseDayTokens/
//    parseTimeRange, kept faithful rather than "cleaned up" so it stays easy
//    to diff against the source if CRS-Monitor's format ever changes.
// ===========================================================================

export interface CrsParsedBlock {
  days: string[]; // e.g. ["T", "Th"]
  startMinutes: number;
  endMinutes: number;
  // Optional: only set by parseCrsScheduleBlocks() below (paired from the
  // `schedule` free-text column — see extractRoomsFromSchedule). Blocks
  // produced by parseScheduleText() never set this; that function only
  // has day/time signal, used for match-confidence scoring, where room
  // isn't relevant.
  room?: string | null;
}

/** Formats minutes-since-midnight as a zero-padded 24h "HHMM" string.
 *  NOTE: despite the name's echo of timeToMinutes() (lib/client-ocr/
 *  textCleanup.ts), the two do NOT round-trip — timeToMinutes() only
 *  parses "H:MM(AM|PM)" and returns 0 for a bare "HHMM" string like this
 *  produces. Do not use this for anything that reaches the UI or gets
 *  saved as start_display/end_display; use textCleanup.ts's
 *  formatMinutesAsDisplay() for that (see its doc comment for why).
 *  Kept only in case something still needs the raw 24h shape. */
export function formatMinutesAsHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

const DAY_TOKEN_PATTERNS: { re: RegExp; code: string }[] = [
  { re: /^Su/i, code: "Su" },
  { re: /^Th/i, code: "Th" },
  { re: /^M/i, code: "M" },
  { re: /^T/i, code: "T" },
  { re: /^W/i, code: "W" },
  { re: /^F/i, code: "F" },
  { re: /^S/i, code: "S" },
];

function parseDayTokens(str: string): string[] {
  const codes: string[] = [];
  let s = str;
  while (s.length) {
    let matched = false;
    for (const p of DAY_TOKEN_PATTERNS) {
      if (p.re.test(s)) {
        codes.push(p.code);
        s = s.replace(p.re, "");
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  return codes;
}

function to24Hour(hourMinStr: string, meridiem: string | undefined): number | null {
  const [hStr, mStr = "0"] = hourMinStr.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  const mer = (meridiem || "").toUpperCase();
  if (mer === "PM" && h !== 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  if (mer === "NN") h = 12;
  if (mer === "MN") h = 0;
  return h * 60 + m;
}

function parseTimeRange(token: string): { startMinutes: number; endMinutes: number } | null {
  const m = token.match(
    /^(\d{1,2}(?::\d{2})?)(AM|PM|NN|MN)?-(\d{1,2}(?::\d{2})?)(AM|PM|NN|MN)?$/i
  );
  if (!m) return null;
  const [, startRaw, startMerRaw, endRaw, endMerRaw] = m;
  let startMer = startMerRaw;
  let endMer = endMerRaw;

  if (!startMer && endMer) {
    const startHour = parseInt(startRaw.split(":")[0], 10);
    const endHour = parseInt(endRaw.split(":")[0], 10);
    if (/PM/i.test(endMer) && startHour > endHour && startHour !== 12) {
      startMer = "AM";
    } else {
      startMer = endMer;
    }
  } else if (startMer && !endMer) {
    endMer = startMer;
  }

  const startMinutes = to24Hour(startRaw, startMer);
  const endMinutes = to24Hour(endRaw, endMer);
  if (startMinutes === null || endMinutes === null) return null;
  return { startMinutes, endMinutes };
}

export function parseScheduleText(scheduleText: string | null | undefined): CrsParsedBlock[] {
  if (!scheduleText) return [];
  const segments = scheduleText.split(";").map((s) => s.trim()).filter(Boolean);
  const blocks: CrsParsedBlock[] = [];

  for (const seg of segments) {
    const m = seg.match(/^([A-Za-z]+)\s+(\S+)/);
    if (!m) continue;
    const [, dayToken, timeToken] = m;
    const days = parseDayTokens(dayToken);
    const range = parseTimeRange(timeToken);
    if (days.length === 0 || !range) continue; // e.g. "TBA"
    blocks.push({ days, startMinutes: range.startMinutes, endMinutes: range.endMinutes });
  }

  return blocks;
}

// OCR's ScheduleEntry.day is a full name ("Mon","Tue",...); CRS's day codes
// are "M","T","W","Th","F","S","Su". Map once, here, rather than scattering
// this translation across scoring code.
const OCR_DAY_TO_CRS_CODE: Record<string, string> = {
  Mon: "M",
  Tue: "T",
  Wed: "W",
  Thu: "Th",
  Fri: "F",
  Sat: "S",
  Sun: "Su",
};

// Reverse of the map above. CrsParsedBlock.days holds CRS's short day
// codes, and a single block commonly lists SEVERAL of them at once (e.g.
// { days: ["T","Th"], ... } for a TTh lecture) — but every consumer of
// schedule_entries.day (the weekly grid in app/schedule/page.tsx,
// GroupScheduleGrid, CalendarView's day filtering, and the correction
// table's day <select>) expects exactly ONE of "Mon"/"Tue"/.../"Sun" per
// row, matching how non-enriched OCR rows are already stored (one row per
// single meeting day — see the "day-row grouping" note at the top of this
// file). Use expandParsedBlocks() below rather than `block.days.join(",")`
// when turning a block into row(s) to insert/save — a joined value like
// "T,Th" doesn't equal any single day, so that row silently never renders
// in any day's column.
const CRS_CODE_TO_OCR_DAY: Record<string, string> = {
  M: "Mon",
  T: "Tue",
  W: "Wed",
  Th: "Thu",
  F: "Fri",
  S: "Sat",
  Su: "Sun",
};

export interface ExpandedDayRow {
  day: string; // full name, e.g. "Tue" — matches schedule_entries.day
  startMinutes: number;
  endMinutes: number;
  // Carried through from the source CrsParsedBlock's `room` (see above) —
  // both day-rows expanded from the same lec/lab block share its room.
  room?: string | null;
}

/**
 * Expands parsed CRS schedule blocks into one row per single meeting day,
 * in the app's full-day-name convention. This is the one place that should
 * ever turn a CrsParsedBlock's `days` array into row(s) — see the
 * CRS_CODE_TO_OCR_DAY comment above for why a comma-joined day string is
 * wrong here.
 */
export function expandParsedBlocks(blocks: CrsParsedBlock[]): ExpandedDayRow[] {
  const rows: ExpandedDayRow[] = [];
  for (const block of blocks) {
    for (const code of block.days) {
      const day = CRS_CODE_TO_OCR_DAY[code];
      if (!day) continue; // unrecognized code — skip rather than store garbage
      rows.push({
        day,
        startMinutes: block.startMinutes,
        endMinutes: block.endMinutes,
        room: block.room ?? null,
      });
    }
  }
  return rows;
}

// ===========================================================================
// 3.5. Pairing room (from `schedule` free text) with CRS's structured
//    `scheduleBlocksJson`, and parsing the latter into CrsParsedBlock[].
//
//    scheduleBlocksJson has no room field of its own (see types.ts) — room
//    only ever lives inside `schedule`'s free text, one value per
//    "; "-split segment, in the same left-to-right order as
//    scheduleBlocksJson's array. Confirmed real example:
//      schedule = "Th 7-8AM lec TBA; WF 7-8:30AM lec MB 301"
//      scheduleBlocksJson = [{"days":["Th"],...}, {"days":["W","F"],...}]
//      -> segment 0 "Th 7-8AM lec TBA"     -> block 0 -> room "TBA"
//      -> segment 1 "WF 7-8:30AM lec MB 301" -> block 1 -> room "MB 301"
// ===========================================================================

/**
 * Session-type keywords that can appear between a segment's time range and
 * its room (e.g. "Th 7-8AM lec TBA"). Confirmed against real data: "lec".
 * "lab" is included on the strength of lec+lab sections being the whole
 * reason room is per-segment rather than per-class — but neither this list
 * nor its completeness has been checked against a wider live sample (no
 * Turso access in this task). If a `schedule` segment's leftover text after
 * stripping day/time still starts with an unrecognized short keyword
 * before the actual room, extend this list rather than special-casing it
 * at a call site.
 */
export const SESSION_TYPE_KEYWORDS = ["lec", "lab"];

/** Matches a segment's leading day-token + time-range, e.g. "Th 7-8AM" or
 *  "WF 7-8:30AM" — the exact prefix shape parseScheduleText()'s own segment
 *  regex expects (day letters, then one non-space time-range token).
 *  Reused here rather than re-derived, per the comment on parseScheduleText
 *  above this section. */
const DAY_TIME_PREFIX_RE = /^([A-Za-z]+)\s+(\S+)/;

/**
 * Extracts one room string per "; "-split segment of CRS's free-text
 * `schedule` column, positionally aligned with scheduleBlocksJson's parsed
 * array (index i of the result pairs with block i). Strips each segment's
 * leading day+time prefix (reusing parseScheduleText's segment shape) and
 * an optional session-type keyword; whatever's left is the room. "TBA" is
 * a valid room value (arranged/unassigned) and is kept as-is, not
 * converted to null.
 *
 * If schedule's segment count doesn't match `blockCount`, the pairing
 * can't be trusted — this flags rather than guesses (same "flag rather
 * than silently guess" pattern as groupOcrEntries' known-limitation note
 * above): logs a warning and returns `blockCount` nulls.
 */
export function extractRoomsFromSchedule(
  schedule: string | null | undefined,
  blockCount: number
): (string | null)[] {
  if (blockCount === 0) return [];
  if (!schedule) return Array(blockCount).fill(null);

  const segments = schedule.split("; ").map((s) => s.trim()).filter(Boolean);
  if (segments.length !== blockCount) {
    console.warn(
      `extractRoomsFromSchedule: "${schedule}" has ${segments.length} segment(s) but ` +
        `scheduleBlocksJson has ${blockCount} block(s) — can't positionally pair room, ` +
        `treating room as unknown for all blocks.`
    );
    return Array(blockCount).fill(null);
  }

  return segments.map((seg) => {
    const dayTimeMatch = seg.match(DAY_TIME_PREFIX_RE);
    if (!dayTimeMatch) return null;
    let rest = seg.slice(dayTimeMatch[0].length).trim();

    const keywordMatch = rest.match(/^([A-Za-z]+)\b\s*/);
    if (keywordMatch && SESSION_TYPE_KEYWORDS.includes(keywordMatch[1].toLowerCase())) {
      rest = rest.slice(keywordMatch[0].length).trim();
    }

    return rest.length > 0 ? rest : null;
  });
}

interface RawScheduleBlockJson {
  days?: string[];
  start?: string; // "HH:MM", 24h
  end?: string; // "HH:MM", 24h
}

/** Parses a "HH:MM" 24h string into minutes-since-midnight, or null if it
 *  doesn't match that shape. */
function hhmmStringToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(mins)) return null;
  return h * 60 + mins;
}

/**
 * Parses CrsSection.scheduleBlocksJson (structured, one entry per meeting
 * segment) into CrsParsedBlock[], with each block's `room` filled in by
 * positionally pairing against `schedule`'s free text (see
 * extractRoomsFromSchedule). Preferred over parseScheduleText(schedule) for
 * building rows to actually save: scheduleBlocksJson is CRS-Monitor's own
 * structured parse (already "HH:MM", one entry per segment reliably)
 * rather than a client-side re-parse of free text. parseScheduleText is
 * untouched and still used where it always was — matchServer.ts's
 * match-confidence scoring — which only needs a rough day/time signal.
 *
 * A block whose start/end/days don't parse is dropped (same "skip rather
 * than store garbage" stance as expandParsedBlocks' unrecognized-day-code
 * handling above).
 */
export function parseCrsScheduleBlocks(
  scheduleBlocksJson: string,
  schedule: string | null | undefined
): CrsParsedBlock[] {
  let raw: RawScheduleBlockJson[];
  try {
    const parsed = JSON.parse(scheduleBlocksJson);
    raw = Array.isArray(parsed) ? parsed : [];
  } catch {
    raw = [];
  }

  const rooms = extractRoomsFromSchedule(schedule, raw.length);

  const blocks: CrsParsedBlock[] = [];
  raw.forEach((entry, i) => {
    const days = Array.isArray(entry.days) ? entry.days : [];
    const startMinutes = typeof entry.start === "string" ? hhmmStringToMinutes(entry.start) : null;
    const endMinutes = typeof entry.end === "string" ? hhmmStringToMinutes(entry.end) : null;
    if (days.length === 0 || startMinutes === null || endMinutes === null) return;
    blocks.push({ days, startMinutes, endMinutes, room: rooms[i] ?? null });
  });

  return blocks;
}

// ===========================================================================
// 4. Confidence model
// ===========================================================================
//
// Written down explicitly because this is the part most likely to need
// tuning later against real mismatches (per the build plan) — it should be
// legible, not just correct.
//
// Score is 0-100, built additively from independent signals, then capped:
//
//   +40  subject matched (via CRS's own subject list, case/whitespace
//        normalized — see resolveCanonicalSubject below). This is a hard
//        gate: candidates are only pulled from CRS-Monitor for a subject
//        we could resolve, so every candidate reaching this scorer already
//        has this.
//   +25  course number matched exactly (tokens equal after normalization).
//        Hard gate as well — see filterByCourseNumber. Combined with the
//        subject gate, every candidate reaching this scorer is already a
//        same-subject-same-course-number CrsSection; what's left to settle
//        is WHICH SECTION.
//   +20  section fragment: exact match (normalized) between OCR's section
//        and CRS's section.
//   +10  section fragment: segment/prefix match only (one is a substring
//        of the other, but not equal) — screenshots can truncate the
//        section code, so this still counts as real signal, just weaker.
//    +0  no section signal at all (OCR section fragment empty, or it
//        doesn't match/prefix/segment-match this candidate's section).
//   +15  schedule/day-time signal: OCR's day-rows and this candidate's
//        parsed `schedule` blocks agree — same set of day codes AND every
//        OCR day-row's start time is within 10 minutes of some block on
//        the same day in the candidate. This is a secondary disambiguator,
//        deliberately worth less than the section fragment, since OCR's
//        times/section are themselves sometimes wrong (the screenshot
//        truncates both), but two independently-read fields agreeing is
//        still real evidence.
//   +7   partial schedule/day-time signal: day codes overlap (non-empty
//        intersection) but aren't identical, or days match and times are
//        close-but-not-within-10-minutes on at least one day.
//
// CONFIDENCE_THRESHOLD = 60. Below it: "needs manual confirmation" — never
// auto-picked, even if it's the only candidate. Rationale for the number:
// 40 (subject) + 25 (number) + 0 (no section signal) = 65 would already
// clear a lower threshold on subject+number alone, which is exactly the
// case (no section signal at all) that should NOT be auto-applied, since
// subject+number alone is routinely a multi-section lecture. Setting the
// threshold at 60 doesn't fully prevent that (65 still clears it) — so
// full auto-match additionally REQUIRES at least +10 from the section
// signal band (see isConfidentMatch below); the numeric threshold alone
// is necessary but not sufficient.
//
// UNIQUENESS: even a single candidate above threshold is only returned as
// a "matched" result if the section-signal requirement above is met AND
// it's the sole candidate at-or-above CONFIDENCE_THRESHOLD; ties or
// multiple qualifying candidates are always returned as "candidates" for
// manual pick, never auto-resolved by score alone.

// Confidence threshold and scoring/matching logic that calls out to
// CRS-Monitor (resolveCanonicalSubject, matchOcrClass, matchAllOcrEntries,
// and their private helpers) now live in ./matchServer — see the note at
// the top of this file for why.
export const CONFIDENCE_THRESHOLD = 60;

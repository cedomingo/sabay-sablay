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

import type { CrsSection } from "./types";
import { getAllSectionsForSubject, getSubjects } from "./client";
import type { ScheduleEntry } from "../client-ocr/types";

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

function normalizeSection(s: string): string {
  return s.replace(/[\s-]+/g, "").trim().toUpperCase();
}

/** Pulls the number token(s) out of a CRS `course` string (e.g.
 *  "Art Stud 299" -> "299", "CWTS 1 and 2" -> "1 and 2") using the same
 *  boundary rule, so it can be compared against our re-split OCR number. */
function extractCrsCourseNumber(crsCourse: string): string {
  // CRS's `course` field is subject+number with no section (section is a
  // separate field on CrsSection), so this is just the same boundary rule
  // applied directly — e.g. "Art Stud 299" -> subject "Art Stud", number
  // "299"; "CWTS 1 and 2" -> number "1 and 2" via the "and <number>"
  // extension.
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
}

/** Formats minutes-since-midnight as a zero-padded 24h "HHMM" string, the
 *  same shape callers' own timeToMinutes() parses back (see correction
 *  page). Used to turn parseScheduleText()'s numeric blocks into the
 *  display strings the schedule UI/DB expect. */
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

export function parseScheduleText(scheduleText: string): CrsParsedBlock[] {
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

export const CONFIDENCE_THRESHOLD = 60;
const MIN_SECTION_SIGNAL_FOR_AUTO_MATCH = 10;
const SCHEDULE_TIME_TOLERANCE_MINUTES = 10;

function scoreSectionFragment(ocrSection: string, crsSection: string): number {
  const a = normalizeSection(ocrSection);
  const b = normalizeSection(crsSection);
  if (!a || !b) return 0;
  if (a === b) return 20;
  if (a.includes(b) || b.includes(a)) return 10;
  return 0;
}

function scoreScheduleSignal(dayRows: OcrDayRow[], crsBlocks: CrsParsedBlock[]): number {
  if (dayRows.length === 0 || crsBlocks.length === 0) return 0;

  let exactDayAndTime = true;
  let anyDayOverlap = false;

  for (const row of dayRows) {
    const crsCode = OCR_DAY_TO_CRS_CODE[row.day];
    if (!crsCode) {
      exactDayAndTime = false;
      continue;
    }
    const blocksForDay = crsBlocks.filter((b) => b.days.includes(crsCode));
    if (blocksForDay.length === 0) {
      exactDayAndTime = false;
      continue;
    }
    anyDayOverlap = true;
    const timeMatches = blocksForDay.some(
      (b) => Math.abs(b.startMinutes - row.startMinutes) <= SCHEDULE_TIME_TOLERANCE_MINUTES
    );
    if (!timeMatches) exactDayAndTime = false;
  }

  if (exactDayAndTime) return 15;
  if (anyDayOverlap) return 7;
  return 0;
}

// ===========================================================================
// 5. Public matching API
// ===========================================================================

export interface ScoredCandidate {
  section: CrsSection;
  confidence: number;
}

export type MatchOutcome =
  | { status: "matched"; section: CrsSection; confidence: number }
  | { status: "candidates"; candidates: ScoredCandidate[] }
  | { status: "unmatched"; reason: string };

/**
 * Resolves an OCR'd subject string to CRS-Monitor's exact spelling by
 * checking it against the live subject list (GET /api/sections/subjects),
 * normalized for case/whitespace only. The `subjects` filter on
 * GET /api/sections does an exact string match server-side (see
 * client.ts), so we need CRS's exact casing/spelling before querying —
 * not just our own normalized guess.
 */
export async function resolveCanonicalSubject(
  ocrSubject: string,
  semester?: string
): Promise<string | null> {
  const target = normalizeSubject(ocrSubject);
  if (!target) return null;
  const subjects = await getSubjects(semester);
  const found = subjects.find((s) => normalizeSubject(s.subject) === target);
  return found ? found.subject : null;
}

function filterByCourseNumber(sections: CrsSection[], ocrNumber: string): CrsSection[] {
  const target = ocrNumber.replace(/\s+/g, " ").trim().toLowerCase();
  if (!target) return [];
  return sections.filter(
    (s) => extractCrsCourseNumber(s.course).toLowerCase() === target
  );
}

/**
 * Matches one grouped OCR class against CRS-Monitor. Fetches the candidate
 * pool for the resolved subject, filters to the matching course number,
 * scores every remaining candidate against section fragment + schedule
 * signal, and returns one of three outcomes — never guesses below
 * threshold.
 */
export async function matchOcrClass(
  ocrClass: OcrGroupedClass,
  semester?: string
): Promise<MatchOutcome> {
  const canonicalSubject = await resolveCanonicalSubject(ocrClass.subject, semester);
  if (!canonicalSubject) {
    return { status: "unmatched", reason: `No CRS-Monitor subject matches "${ocrClass.subject}"` };
  }

  const pool = await getAllSectionsForSubject(canonicalSubject, semester);
  const sameCourse = filterByCourseNumber(pool, ocrClass.number);
  if (sameCourse.length === 0) {
    return {
      status: "unmatched",
      reason: `No ${canonicalSubject} ${ocrClass.number} sections found in CRS-Monitor`,
    };
  }

  const scored: ScoredCandidate[] = sameCourse.map((section) => {
    const sectionSignal = scoreSectionFragment(ocrClass.section, section.section);
    const scheduleSignal = scoreScheduleSignal(
      ocrClass.dayRows,
      parseScheduleText(section.schedule)
    );
    const confidence = Math.min(100, 40 + 25 + sectionSignal + scheduleSignal);
    return { section, confidence };
  });

  scored.sort((a, b) => b.confidence - a.confidence);

  const qualifying = scored.filter(
    (c) =>
      c.confidence >= CONFIDENCE_THRESHOLD &&
      scoreSectionFragment(ocrClass.section, c.section.section) >= MIN_SECTION_SIGNAL_FOR_AUTO_MATCH
  );

  if (qualifying.length === 1) {
    return { status: "matched", section: qualifying[0].section, confidence: qualifying[0].confidence };
  }

  if (scored.length === 1 && scored[0].confidence >= CONFIDENCE_THRESHOLD) {
    // Only one candidate exists at all and it clears the bar, but didn't
    // clear the section-signal requirement above (e.g. OCR's section
    // fragment was unreadable). Still surfaced for manual confirmation
    // rather than auto-applied — see confidence model notes.
    return { status: "candidates", candidates: scored };
  }

  const anyAboveThreshold = scored.some((c) => c.confidence >= CONFIDENCE_THRESHOLD);
  if (!anyAboveThreshold) {
    return {
      status: "unmatched",
      reason: `${sameCourse.length} same-course candidate(s) found, none met the confidence threshold`,
    };
  }

  return { status: "candidates", candidates: scored };
}

/** Convenience wrapper: groups raw ScheduleEntry rows and matches each
 *  resulting class. Order of results matches groupOcrEntries()'s order. */
export async function matchAllOcrEntries(
  entries: ScheduleEntry[],
  semester?: string
): Promise<{ ocrClass: OcrGroupedClass; outcome: MatchOutcome }[]> {
  const groups = groupOcrEntries(entries);
  const results = [];
  for (const ocrClass of groups) {
    results.push({ ocrClass, outcome: await matchOcrClass(ocrClass, semester) });
  }
  return results;
}

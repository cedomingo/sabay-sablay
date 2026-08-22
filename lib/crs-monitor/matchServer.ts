import 'server-only';

// Server-only matching logic: everything here calls out to CRS-Monitor via
// ./client (which reads process.env.CRS_MONITOR_API_URL and throws at
// module-load time if it's unset). This file must ONLY be imported from
// server code (API routes, server actions) — never from a "use client"
// component or anything it imports, or Next.js will bundle ./client into
// the browser build and crash on load (undefined env var -> throw at
// import time -> whole page fails to mount with no visible error).
//
// Pure/parsing helpers that correction/page.tsx needs (parseScheduleText,
// formatMinutesAsHHMM, groupOcrEntries, etc.) stay in ./matcher, which has
// no dependency on ./client and is safe to import client-side.

import type { CrsSection } from "./types";
import { getAllSectionsForSubject, getSubjects } from "./client";
import type { ScheduleEntry } from "../client-ocr/types";
import {
  normalizeSubject,
  groupOcrEntries,
  parseScheduleText,
  CONFIDENCE_THRESHOLD,
  type OcrGroupedClass,
  type OcrDayRow,
  type CrsParsedBlock,
  reSplitRawCourseText,
} from "./matcher";

const MIN_SECTION_SIGNAL_FOR_AUTO_MATCH = 10;
const SCHEDULE_TIME_TOLERANCE_MINUTES = 10;

function normalizeSection(s: string): string {
  return s.replace(/[\s-]+/g, "").trim().toUpperCase();
}

/** Pulls the number token(s) out of a CRS `course` string (e.g.
 *  "Art Stud 299" -> "299", "CWTS 1 and 2" -> "1 and 2") using the same
 *  boundary rule, so it can be compared against our re-split OCR number. */
function extractCrsCourseNumber(crsCourse: string): string {
  return reSplitRawCourseText(crsCourse).number;
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

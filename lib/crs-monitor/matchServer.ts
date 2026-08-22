import 'server-only';

// Server-only matching logic: everything here calls out to CRS-Monitor via
// ./turso (which reads CRS_MONITOR_TURSO_URL / CRS_MONITOR_TURSO_AUTH_TOKEN
// lazily per-query and throws a CrsMonitorError — not a module-load-time
// throw — if either is unset; see turso.ts's getClient()). This file must
// ONLY be imported from server code (API routes, server actions) — never
// from a "use client" component or anything it imports, or Next.js will
// bundle ./turso's libsql client into the browser build unnecessarily.
//
// Pure/parsing helpers that correction/page.tsx needs (parseScheduleText,
// formatMinutesAsHHMM, groupOcrEntries, etc.) stay in ./matcher, which has
// no dependency on ./turso and is safe to import client-side.

import type { CrsSection } from "./types";
import { getAllSectionsForSubject, getSubjects } from "./turso";
import type { ScheduleEntry } from "../client-ocr/types";
import {
  normalizeSubject,
  groupOcrEntries,
  parseScheduleText,
  CONFIDENCE_THRESHOLD,
  OCR_DAY_TO_CRS_CODE,
  type OcrGroupedClass,
  type OcrDayRow,
  type CrsParsedBlock,
  extractCrsCourseNumber,
} from "./matcher";

const MIN_SECTION_SIGNAL_FOR_AUTO_MATCH = 10;
const SCHEDULE_TIME_TOLERANCE_MINUTES = 10;
// scoreScheduleSignal's "exact day+time agreement" band. Exported value is
// what makes a candidate decisive in the lec/lab tie-break (see the
// confidence-model notes in matcher.ts).
const SCHEDULE_EXACT_SIGNAL = 15;

function normalizeSection(s: string): string {
  return s.replace(/[\s-]+/g, "").trim().toUpperCase();
}

/**
 * Splits an OCR section fragment that may encode an attached lab into its
 * components: "THAB/HWX" -> ["THAB", "HWX"] (lecture THAB, lab HWX —
 * CRS-Monitor stores these as SEPARATE section rows). Slash-free
 * fragments ("WFV") come back as a one-element array. Empty components
 * (stray slashes) are dropped.
 */
export function splitSectionComponents(ocrSection: string): string[] {
  return ocrSection
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Scores OCR's section fragment against one candidate's CRS section code.
 * Component-aware (see splitSectionComponents): the compound lecture+lab
 * text a student's schedule shows ("THAB/HWX") must not be treated as one
 * opaque substring — the component that names THIS row matches it exactly
 * (+20), while the other component simply describes a different DB row.
 * Scoring against every component and taking the best keeps slash-free
 * fragments behaving exactly as before.
 */
function scoreSectionFragment(ocrSection: string, crsSection: string): number {
  const b = normalizeSection(crsSection);
  if (!b) return 0;
  let best = 0;
  for (const comp of splitSectionComponents(ocrSection)) {
    const a = normalizeSection(comp);
    if (!a) continue;
    if (a === b) return 20;
    if ((a.includes(b) || b.includes(a)) && best < 10) best = 10;
  }
  return best;
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
  /** Per-candidate signal bands, kept on the candidate so the decisive-
   *  schedule tie-break doesn't have to re-run the scorers, and so the
   *  client can reuse them when filtering which options are relevant
   *  enough to show. Optional for wire-shape tolerance. */
  sectionSignal?: number;
  scheduleSignal?: number;
}

export type MatchOutcome =
  | { status: "matched"; section: CrsSection; confidence: number }
  | { status: "candidates"; candidates: ScoredCandidate[] }
  // `pool` carries the full scored same-course list (best first) for the
  // correction page's "Can't find your section? Click here for more
  // results." escape hatch — the user can manually pick from sections that
  // didn't clear the confidence threshold. Absent when there is nothing to
  // offer (subject unresolvable, course number not found).
  | { status: "unmatched"; reason: string; pool?: ScoredCandidate[] };

/**
 * Resolves an OCR'd subject string to CRS-Monitor's exact spelling by
 * checking it against the live subject list (distinct `subject` values in
 * the `sections` table, via ./turso's getSubjects()), normalized for
 * case/whitespace only. getAllSectionsForSubject()'s subject filter does an
 * exact string match against the `subject` column, so we need CRS's exact
 * casing/spelling before querying — not just our own normalized guess.
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
    return { section, confidence, sectionSignal, scheduleSignal };
  });

  scored.sort((a, b) => b.confidence - a.confidence);

  const qualifying = scored.filter(
    (c) =>
      c.confidence >= CONFIDENCE_THRESHOLD &&
      (c.sectionSignal ?? 0) >= MIN_SECTION_SIGNAL_FOR_AUTO_MATCH
  );

  if (qualifying.length === 1) {
    return { status: "matched", section: qualifying[0].section, confidence: qualifying[0].confidence };
  }

  // Exact-section override (the "Eng 13 WFW-4 asks anyway" fix): when the
  // OCR'd section fragment names one qualifying candidate's section EXACTLY
  // — full normalized equality against the whole `section` string, not a
  // component/prefix hit — that candidate IS the answer, outright. The old
  // flow only ever broke ties on schedule signal, so parallel sections of
  // the same course meeting at the SAME timeslot (routine in real data,
  // e.g. Eng 13's WFW-x rows all at WF 1-2:30PM) tied at +15 and fell
  // through to a manual prompt even though the screenshot literally states
  // the section code — and weaker prefix collisions ("WFW" ⊂ "WFW4",
  // "WFW40" ⊃ "WFW4") could even qualify alongside it via the +10 band.
  //
  // normalizeSection() keeps "/" intact, so this cannot hijack the lec/lab
  // compound case: fragment "THAB/HWX" full-equals only a literal
  // "THAB/HWX" DB row, never the plain "THAB" lecture (whose +20 comes
  // from COMPONENT scoring, which deliberately does NOT count as exact
  // here). If two qualifiers both full-equal (duplicate section codes),
  // fall through — genuinely ambiguous.
  const ocrFullNorm = normalizeSection(ocrClass.section);
  if (ocrFullNorm) {
    const exactFull = qualifying.filter(
      (q) => q.section.section && normalizeSection(q.section.section) === ocrFullNorm
    );
    if (exactFull.length === 1) {
      return {
        status: "matched",
        section: exactFull[0].section,
        confidence: exactFull[0].confidence,
      };
    }
  }

  // Lec/lab tie-break: when several candidates qualify (e.g. the THAB
  // lecture row and the HWX lab row both clear the bar for one of the two
  // "CS 20" groups), let the group's own OCR'd meeting times decide. If
  // exactly one candidate agrees with those times EXACTLY (+15 band), it
  // wins outright — no prompt. Anything less decisive stays a manual pick.
  if (qualifying.length > 1) {
    const maxScheduleSignal = Math.max(
      ...qualifying.map((q) => q.scheduleSignal ?? 0)
    );
    if (maxScheduleSignal >= SCHEDULE_EXACT_SIGNAL) {
      const decisive = qualifying.filter((q) => q.scheduleSignal === maxScheduleSignal);
      if (decisive.length === 1) {
        return { status: "matched", section: decisive[0].section, confidence: decisive[0].confidence };
      }
    }
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
      pool: scored,
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

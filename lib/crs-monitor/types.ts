
/**
 * CRS-Monitor's `sections` table, queried directly over Turso/libSQL (see
 * ./turso.ts) — 1:1 with the real columns, not a guessed wire shape.
 * IMPORTANT:
 *   - `classCode` is CRS's full registration code (e.g. "57851" or "57851-THQ1").
 *   - `section` is the short letter fragment students see on their screenshot (e.g. "WFV").
 *   - The matcher must fuzzy-match OCR's section fragment against `section`, NOT `classCode`.
 *   - `schedule` is raw free text (e.g. "Th 7-8AM lec TBA; WF 7-8:30AM lec MB 301").
 *     Room is NOT a separate column — it only ever lives inside this text.
 *   - `scheduleBlocksJson` is the structured per-segment day/time breakdown
 *     (shape: [{"days":["Th"],"start":"07:00","end":"08:00"}, ...]) but it
 *     has NO room field. Positionally matching a `schedule` segment (split
 *     on "; ") to its corresponding scheduleBlocksJson entry, in order, is
 *     how room gets attached to a parsed block — that mapping is Phase 2,
 *     not implemented here.
 *   - `remarks` is prerequisite/co-requisite text (e.g. "Prerequisite: Math 22"),
 *     NOT a room, despite existing call sites in correction/page.tsx and
 *     lib/actions/schedule.ts currently reading it as one (Phase 2 fixes that).
 *   - `restrictions` is enlistment eligibility text (e.g. "For: BS MetE(25 slots)").
 *   - `blocksJson` is a per-enlisting-unit slot breakdown, unrelated to meeting times.
 *   - Nullability below matches the real schema, not the old assumed-non-null wire type.
 */

export interface CrsSection {
  id: number;
  semesterCode: string;
  classCode: string;
  subject: string;
  course: string;
  section: string;
  credits: string | null;
  schedule: string | null;
  instructor: string | null;
  mode: string | null;     // "Asynchronous", "Arranged", etc.
  remarks: string | null;
  availableSlots: number | null;
  totalSlots: number | null;
  demand: string | null;
  restrictions: string | null;
  blocksJson: string | null;
  letter: string | null;
  firstDetected: string;
  lastSeen: string;
  title: string | null;
  scheduleBlocksJson: string;
}

export interface CrsSubject {
  subject: string;
  count: number;
}

export class CrsMonitorError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CrsMonitorError';
  }
}

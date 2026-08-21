import 'server-only';

/**
 * CRS-Monitor wire types — 1:1 with GET /api/sections response.
 * IMPORTANT:
 *   - `classCode` is CRS's full registration code (e.g. "57851" or "57851-THQ1").
 *   - `section` is the short letter fragment students see on their screenshot (e.g. "WFV").
 *   - The matcher must fuzzy-match OCR's section fragment against `section`, NOT `classCode`.
 *   - There is no `scheduleBlocks` on the wire — only raw `schedule` free text.
 */

export interface CrsSection {
  id: number;
  classCode: string;
  subject: string;
  course: string;
  section: string;
  title: string;
  credits: number;
  schedule: string;        // free text, e.g. "MWF 0800-0900 A 104"
  instructor: string | null;
  mode: string | null;     // "Asynchronous", "Arranged", etc.
  remarks: string | null;
  availableSlots: number;
  totalSlots: number;
  demand: number | null;
  restrictions: string | null;
  firstDetected: string;
  lastSeen: string;
}

export interface CrsSubject {
  subject: string;
  count: number;
}

export interface CrsCourseSuggestion {
  course: string;
  count: number;
}

export interface GetSectionsParams {
  subject?: string;
  course?: string;
  limit?: number;
  offset?: number;
}

export interface GetSectionsResponse {
  semesterCode: string;
  total: number;
  count: number;
  sections: CrsSection[];
}

export class CrsMonitorError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CrsMonitorError';
  }
}
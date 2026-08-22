import 'server-only';

// Server-only data-access module for CRS-Monitor's actual storage: Turso
// (libSQL), same account, different project from this app's own Supabase
// DB. Replaces the old client.ts, which talked to
// CRS-Monitor over HTTP — that service is gone; this queries CRS-Monitor's
// `sections`/`semesters` tables directly.
//
// Same lazy-init reasoning as client.ts's getApiUrl(): env vars are read
// inside the function that uses them, not at module scope, so a missing
// env var throws a catchable CrsMonitorError instead of crashing the
// module (and the whole route) at import time. See matchServer.ts's
// header comment and app/api/schedule/enrich/route.ts's
// `catch (e) { if (e instanceof CrsMonitorError) ... }` degrade-to-
// unmatched logic, which depends on this contract.
//
// Import boundary: this file must never be reachable from a "use client"
// component, same rule ./client.ts followed. matcher.ts (pure, client-safe
// parsing helpers) must NOT import this file — server-only callers go
// through ./matchServer instead.

import { createClient, type Client } from '@libsql/client';
import { CrsMonitorError } from './types';
import type { CrsSection, CrsSubject } from './types';

function getClient(): Client {
  const url = process.env.CRS_MONITOR_TURSO_URL;
  const authToken = process.env.CRS_MONITOR_TURSO_AUTH_TOKEN;
  if (!url) {
    throw new CrsMonitorError('CRS_MONITOR_TURSO_URL is not set in environment');
  }
  if (!authToken) {
    throw new CrsMonitorError('CRS_MONITOR_TURSO_AUTH_TOKEN is not set in environment');
  }
  return createClient({ url, authToken });
}

/**
 * Wraps a Turso query in the same error-degradation contract client.ts
 * gave HTTP failures: anything unexpected (network error, bad SQL, driver
 * exception) becomes a CrsMonitorError so the enrich route's
 * `instanceof CrsMonitorError` check keeps working unchanged. A
 * CrsMonitorError thrown deliberately inside `fn` (e.g. the active-semester
 * ambiguity check below) passes through as-is rather than getting
 * double-wrapped.
 */
async function withErrorWrapping<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CrsMonitorError) throw err;
    throw new CrsMonitorError(
      `CRS-Monitor Turso query failed: ${(err as Error).message}`,
      err
    );
  }
}

/**
 * Determines the active semester_code when a caller doesn't pass one
 * explicitly — the direct-DB equivalent of what used to be an omitted
 * querystring param that CRS-Monitor's own HTTP server defaulted
 * server-side. Requires exactly one `semesters` row with is_active = 1;
 * zero or multiple matches is a data-integrity problem this must not
 * paper over by guessing, so it throws CrsMonitorError instead.
 */
async function getActiveSemesterCode(): Promise<string> {
  return withErrorWrapping(async () => {
    const client = getClient();
    const result = await client.execute(
      'SELECT semester_code FROM semesters WHERE is_active = 1'
    );
    if (result.rows.length === 0) {
      throw new CrsMonitorError('No active semester found (0 rows with is_active = 1 in semesters)');
    }
    if (result.rows.length > 1) {
      throw new CrsMonitorError(
        `Ambiguous active semester (${result.rows.length} rows with is_active = 1 in semesters)`
      );
    }
    return String(result.rows[0].semester_code);
  });
}

/**
 * Resolves the semester_code to query against: the caller's explicit
 * value if given, otherwise the active semester. Same threading as
 * client.ts's optional `semester` param through getSubjects() /
 * getAllSectionsForSubject() — see matchAllOcrEntries()/matchOcrClass() in
 * ./matchServer, which pass this through unchanged from the enrich route.
 */
async function resolveSemesterCode(semester?: string): Promise<string> {
  if (semester) return semester;
  return getActiveSemesterCode();
}

function mapSectionRow(row: Record<string, unknown>): CrsSection {
  const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

  return {
    id: Number(row.id),
    semesterCode: String(row.semester_code),
    classCode: String(row.class_code),
    subject: String(row.subject),
    course: String(row.course),
    section: String(row.section),
    credits: str(row.credits),
    schedule: str(row.schedule),
    instructor: str(row.instructor),
    mode: str(row.mode),
    remarks: str(row.remarks),
    availableSlots: num(row.available_slots),
    totalSlots: num(row.total_slots),
    demand: str(row.demand),
    restrictions: str(row.restrictions),
    blocksJson: str(row.blocks_json),
    letter: str(row.letter),
    firstDetected: String(row.first_detected),
    lastSeen: String(row.last_seen),
    title: str(row.title),
    scheduleBlocksJson: String(row.schedule_blocks_json ?? '[]'),
  };
}

/**
 * Distinct subjects for a semester, with counts — what matchServer.ts's
 * resolveCanonicalSubject() used to get from client.ts's getSubjects().
 */
export async function getSubjects(semester?: string): Promise<CrsSubject[]> {
  return withErrorWrapping(async () => {
    const semesterCode = await resolveSemesterCode(semester);
    const client = getClient();
    const result = await client.execute({
      sql: 'SELECT subject, COUNT(*) as count FROM sections WHERE semester_code = ? GROUP BY subject',
      args: [semesterCode],
    });
    return result.rows.map((row) => ({
      subject: String(row.subject),
      count: Number(row.count),
    }));
  });
}

/**
 * All sections for a subject + semester_code — what matchServer.ts's
 * matchOcrClass() used to get (paginated past a 2000-row server cap) from
 * client.ts's getAllSectionsForSubject(). No server-side page cap here
 * (that cap belonged to the now-gone HTTP API), so this is a single query.
 */
export async function getAllSectionsForSubject(
  subject: string,
  semester?: string
): Promise<CrsSection[]> {
  return withErrorWrapping(async () => {
    const semesterCode = await resolveSemesterCode(semester);
    const client = getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM sections WHERE semester_code = ? AND subject = ?',
      args: [semesterCode, subject],
    });
    return result.rows.map((row) => mapSectionRow(row as unknown as Record<string, unknown>));
  });
}

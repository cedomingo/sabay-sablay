import {
  CrsSection,
  CrsSubject,
  CrsCourseSuggestion,
  GetSectionsParams,
  GetSectionsResponse,
  CrsMonitorError,
} from './types';

// IMPORTANT: this used to read `process.env.CRS_MONITOR_API_URL` once at
// module scope and throw a plain `Error` immediately if it was unset. That
// throw fired at *import* time — before matchAllOcrEntries() ever ran,
// outside the enrich route's try/catch — so a missing/misconfigured env
// var crashed the whole route module and Next.js returned its own
// framework 500, never reaching the `CrsMonitorError` branch that degrades
// gracefully to `unmatched: [...reason: 'crs_unreachable']`. Resolved
// lazily instead, inside fetchWithTimeout, so a missing env var surfaces
// as a normal CrsMonitorError like any other CRS-Monitor failure.
function getApiUrl(): string {
  const url = process.env.CRS_MONITOR_API_URL;
  if (!url) {
    throw new CrsMonitorError('CRS_MONITOR_API_URL is not set in environment');
  }
  return url;
}

const SECTION_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 3000;
const PAGE_CAP = 2000; // CRS-Monitor server hard cap per request

async function fetchWithTimeout<T>(
  path: string,
  timeoutMs: number
): Promise<T> {
  const url = `${getApiUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new CrsMonitorError(`HTTP ${res.status} from ${url}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof CrsMonitorError) throw err;
    throw new CrsMonitorError(
      `CRS-Monitor request failed: ${(err as Error).message}`,
      err
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function getSubjects(semester?: string): Promise<CrsSubject[]> {
  const qs = new URLSearchParams();
  if (semester) qs.set('semester', semester);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const data = await fetchWithTimeout<{ subjects: CrsSubject[] }>(
    `/api/sections/subjects${suffix}`,
    SECTION_TIMEOUT_MS
  );
  // Defense in depth: an unexpected response shape (e.g. CRS-Monitor
  // changes its API, or a proxy/error page returns 200 with HTML/JSON
  // that isn't the documented shape) must degrade the same way a network
  // failure does — a plain TypeError from `.find()`/`.filter()` further
  // downstream in matchServer.ts would otherwise slip past the route's
  // `instanceof CrsMonitorError` check and 500 instead of returning the
  // graceful unmatched/crs_unreachable result.
  if (!data || !Array.isArray(data.subjects)) {
    throw new CrsMonitorError('Unexpected response shape from /api/sections/subjects (missing "subjects" array)');
  }
  return data.subjects;
}

export async function getCourseSuggestions(
  search: string
): Promise<CrsCourseSuggestion[]> {
  if (!search) return [];
  const data = await fetchWithTimeout<{ courses: CrsCourseSuggestion[] }>(
    `/api/sections/courses?search=${encodeURIComponent(search)}`,
    SECTION_TIMEOUT_MS
  );
  if (!data || !Array.isArray(data.courses)) {
    throw new CrsMonitorError('Unexpected response shape from /api/sections/courses (missing "courses" array)');
  }
  return data.courses;
}

export async function getSections(
  params: GetSectionsParams = {}
): Promise<GetSectionsResponse> {
  const qs = new URLSearchParams();
  if (params.subject) qs.set('subject', params.subject);
  if (params.course) qs.set('course', params.course);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.semester) qs.set('semester', params.semester);
  const data = await fetchWithTimeout<GetSectionsResponse>(
    `/api/sections?${qs.toString()}`,
    SECTION_TIMEOUT_MS
  );
  // Same shape-validation reasoning as getSubjects() above: getSections()
  // is what getAllSectionsForSubject() pages through inside matchOcrClass,
  // so an unvalidated `.sections`/`.total` here is the most likely place a
  // shape drift would otherwise surface as an unhandled TypeError deep in
  // matching logic instead of a clean CrsMonitorError.
  if (!data || !Array.isArray(data.sections) || typeof data.total !== 'number') {
    throw new CrsMonitorError('Unexpected response shape from /api/sections (missing "sections" array or "total")');
  }
  return data;
}

/**
 * Paginates past the 2000-row server cap. Use this when you need
 * every section for a subject (matcher does this).
 */
export async function getAllSectionsForSubject(
  subject: string,
  semester?: string
): Promise<CrsSection[]> {
  const all: CrsSection[] = [];
  let offset = 0;
  while (true) {
    const page = await getSections({ subject, limit: PAGE_CAP, offset, semester });
    all.push(...page.sections);
    if (all.length >= page.total || page.sections.length < PAGE_CAP) break;
    offset += PAGE_CAP;
  }
  return all;
}

export async function checkHealth(): Promise<boolean> {
  try {
    await fetchWithTimeout<{ status: string }>(
      `/api/health`,
      HEALTH_TIMEOUT_MS
    );
    return true;
  } catch {
    return false;
  }
}
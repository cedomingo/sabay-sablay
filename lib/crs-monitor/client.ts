import 'server-only';
import {
  CrsSection,
  CrsSubject,
  CrsCourseSuggestion,
  GetSectionsParams,
  GetSectionsResponse,
  CrsMonitorError,
} from './types';

const API_URL = process.env.CRS_MONITOR_API_URL;
if (!API_URL) {
  throw new Error('CRS_MONITOR_API_URL is not set in environment');
}

const SECTION_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 3000;
const PAGE_CAP = 2000; // CRS-Monitor server hard cap per request

async function fetchWithTimeout<T>(
  url: string,
  timeoutMs: number
): Promise<T> {
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
    `${API_URL}/api/sections/subjects${suffix}`,
    SECTION_TIMEOUT_MS
  );
  return data.subjects ?? [];
}

export async function getCourseSuggestions(
  search: string
): Promise<CrsCourseSuggestion[]> {
  if (!search) return [];
  const data = await fetchWithTimeout<{ courses: CrsCourseSuggestion[] }>(
    `${API_URL}/api/sections/courses?search=${encodeURIComponent(search)}`,
    SECTION_TIMEOUT_MS
  );
  return data.courses ?? [];
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
  return fetchWithTimeout<GetSectionsResponse>(
    `${API_URL}/api/sections?${qs.toString()}`,
    SECTION_TIMEOUT_MS
  );
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
      `${API_URL}/api/health`,
      HEALTH_TIMEOUT_MS
    );
    return true;
  } catch {
    return false;
  }
}
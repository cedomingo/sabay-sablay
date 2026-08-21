// Server-only fetch wrapper around CRS-Monitor's deployed REST API.
// Never import this from a Client Component (enforced by the `server-only`
// import below, not just a comment-level promise).
//
// Talks to CRS-Monitor only over its REST API, never its DB directly — the
// two apps are independent deploys. Every call has a timeout: enrichment
// must degrade gracefully (an unmatched/unreachable entry should never break
// the upload/correction flow), so callers get a typed CrsMonitorError they
// can catch and treat as "CRS-Monitor is down" rather than "no match found".

import "server-only";
import type {
  CrsSection,
  CrsSubject,
  CrsCourseSuggestion,
  CrsHealth,
  GetSectionsResponse,
  GetSectionsParams,
} from "./types";

const BASE_URL = process.env.CRS_MONITOR_API_URL;

const SECTIONS_TIMEOUT_MS = 8_000;
const HEALTH_TIMEOUT_MS = 3_000;

// Server clamps this to 2000 regardless of what we ask for
// (see server/routes/sections.js: `Math.min(parseInt(...), 2000)`).
const SERVER_MAX_LIMIT = 2000;

export class CrsMonitorError extends Error {
  constructor(
    message: string,
    public readonly cause?: "timeout" | "network" | "http" | "bad_json",
    public readonly status?: number
  ) {
    super(message);
    this.name = "CrsMonitorError";
  }
}

async function fetchWithTimeout(
  path: string,
  timeoutMs: number
): Promise<Response> {
  if (!BASE_URL) {
    throw new CrsMonitorError(
      "CRS_MONITOR_API_URL is not set",
      "network"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new CrsMonitorError(
        `CRS-Monitor request failed: ${res.status} ${path}`,
        "http",
        res.status
      );
    }
    return res;
  } catch (err) {
    if (err instanceof CrsMonitorError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new CrsMonitorError(
        `CRS-Monitor request timed out after ${timeoutMs}ms: ${path}`,
        "timeout"
      );
    }
    throw new CrsMonitorError(
      `CRS-Monitor request failed: ${path} (${(err as Error)?.message ?? "unknown error"})`,
      "network"
    );
  } finally {
    clearTimeout(timer);
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new CrsMonitorError("CRS-Monitor returned invalid JSON", "bad_json");
  }
}

function buildQuery(params: GetSectionsParams): string {
  const q = new URLSearchParams();
  if (params.semester) q.set("semester", params.semester);
  if (params.search) q.set("search", params.search);
  if (params.subjects?.length) q.set("subjects", params.subjects.join(","));
  if (params.courses?.length) q.set("courses", params.courses.join(","));
  if (params.ge) q.set("ge", "true");
  if (params.days?.length) q.set("days", params.days.join(","));
  if (params.startTime) q.set("startTime", params.startTime);
  if (params.endTime) q.set("endTime", params.endTime);
  q.set("limit", String(Math.min(params.limit ?? 500, SERVER_MAX_LIMIT)));
  q.set("offset", String(params.offset ?? 0));
  return q.toString();
}

/** GET /api/sections/subjects — { subjects: [{ subject, count }] } */
export async function getSubjects(semester?: string): Promise<CrsSubject[]> {
  const q = semester ? `?semester=${encodeURIComponent(semester)}` : "";
  const res = await fetchWithTimeout(`/api/sections/subjects${q}`, SECTIONS_TIMEOUT_MS);
  const data = await parseJson<{ subjects: CrsSubject[] }>(res);
  return data.subjects;
}

/**
 * GET /api/sections/courses?search= — autocomplete only.
 * Empty search returns [] server-side; mirrored here to avoid a wasted call.
 */
export async function getCourseSuggestions(
  search: string,
  semester?: string
): Promise<CrsCourseSuggestion[]> {
  if (!search || !search.trim()) return [];
  const q = new URLSearchParams({ search });
  if (semester) q.set("semester", semester);
  const res = await fetchWithTimeout(`/api/sections/courses?${q.toString()}`, SECTIONS_TIMEOUT_MS);
  const data = await parseJson<{ courses: CrsCourseSuggestion[] }>(res);
  return data.courses;
}

/** GET /api/sections — one page. Server clamps limit to 2000. */
export async function getSections(
  params: GetSectionsParams = {}
): Promise<GetSectionsResponse> {
  const res = await fetchWithTimeout(`/api/sections?${buildQuery(params)}`, SECTIONS_TIMEOUT_MS);
  return parseJson<GetSectionsResponse>(res);
}

/**
 * Paginates past the API's 2000-row cap to fetch every section for one
 * subject. Used by the matcher, which needs the full candidate pool for a
 * subject+course, not just the first page.
 */
export async function getAllSectionsForSubject(
  subject: string,
  semester?: string
): Promise<CrsSection[]> {
  const all: CrsSection[] = [];
  let offset = 0;
  // Loop guard: bail after a generous number of pages rather than looping
  // forever if `total` is ever wrong/stale.
  for (let page = 0; page < 50; page++) {
    const resp = await getSections({
      subjects: [subject],
      semester,
      limit: SERVER_MAX_LIMIT,
      offset,
    });
    all.push(...resp.sections);
    offset += resp.sections.length;
    if (resp.sections.length === 0 || offset >= resp.total) break;
  }
  return all;
}

/** GET /api/health — cheap liveness check, short timeout. */
export async function checkHealth(): Promise<CrsHealth> {
  const res = await fetchWithTimeout("/api/health", HEALTH_TIMEOUT_MS);
  return parseJson<CrsHealth>(res);
}

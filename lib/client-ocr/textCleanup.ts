import { CourseTextCell } from './types';

const TIME_TO_MINUTES_RE = /^(\d{1,2}):(\d{2})(AM|PM)$/i;

export function cleanCourseText(text: string): string {
  return text.replace(/^[^A-Za-z0-9]+/, '').replace(/\s+/g, ' ').trim();
}

export function splitCourse(text: string): { subject: string; number: string; section: string } {
  const m = text.match(/^([A-Za-z]+)\s*([0-9]+[A-Za-z]?)\s*(.*)$/);
  if (m) {
    return { subject: m[1], number: m[2], section: m[3].trim() };
  }
  return { subject: text, number: '', section: '' };
}

export function timeToMinutes(t: string): number {
  const m = t.toUpperCase().match(TIME_TO_MINUTES_RE);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const mnt = parseInt(m[2], 10);
  const ap = m[3];
  if (ap === 'AM') {
    h = h === 12 ? 0 : h;
  } else {
    h = h === 12 ? 12 : h + 12;
  }
  return h * 60 + mnt;
}

/** Formats minutes-since-midnight as "H:MMAM/PM" (e.g. 450 -> "7:30AM"),
 *  the same shape un-enriched OCR rows already display and the only shape
 *  timeToMinutes() above actually parses back. Use this (not
 *  matcher.ts's formatMinutesAsHHMM, which produces a bare 24h "HHMM"
 *  string timeToMinutes() can't read) for any CRS-derived time that
 *  reaches the UI or gets saved as start_display/end_display. Handles the
 *  12AM/12PM edge cases (h=0 -> "12:..AM", h=12 -> "12:..PM").
 *  timeToMinutes(formatMinutesAsDisplay(x)) round-trips for any x. */
export function formatMinutesAsDisplay(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

// ---------------------------------------------------------------------------
// Cross-cell unification of OCR-truncated class names (sample schedule 3 bug)
//
// Grid cells are only as wide as their column, so a long "Class" cell like
// "Physics 72 WFV-HV-4" gets CLIPPED at the edge and Tesseract reads a
// different truncation per cell: "Physics 72 WFV-HV-" here, "Physics 72
// WFV-H" there. Downstream, groupOcrEntries() groups by EXACT raw text, so
// one real class arrived on the correction page as two "Physics 72" blocks
// ("Section WFV-HV" + "Section WFV-H") — matched/saved separately.
//
// canonicalizeCourseVariants() rewrites every cell's course_raw to the most
// complete variant read for that class BEFORE any merging/grouping happens,
// so contiguous-row merging, grouping, matching-removal keys, display and
// save all see one canonical string. Runs on parseScheduleImage()'s per-cell
// entries, before the contiguous same-day merge.
//
// Unification requires ALL of:
//   1. same subject+number after splitCourse() (case-insensitive),
//   2. section identities (lowercase, alphanumerics only — hyphens/spaces
//      are clip noise) equal or PREFIX of one another (truncations form a
//      prefix chain; the longest read wins),
//   3. time-compatible: on any SHARED day the cells' time ranges overlap
//      or directly ABUT (a class's own grid slots tile contiguously).
//      Rule 3 is what keeps genuinely different classes apart even when
//      their codes are prefix-related: CS 20 "THAB" (lecture, TTh
//      7:30-8:30) vs "THAB/HWX" (lab, Th 1-4PM) share the Thursday column
//      but sit hours apart, so they stay separate groups and the
//      matcher's lec/lab handling is untouched. Same-day overlap/adjacency
//      holds for true truncation families because every cell of one class
//      sits in its class's own grid slots.
//
// Cells whose splitCourse() yields no section (nothing to compare) are
// passed through untouched. Input is not mutated; rewritten cells are new
// objects sharing all other fields.
// ---------------------------------------------------------------------------

function sectionIdentity(section: string): string {
  return section.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function timesCompatible(a: CourseTextCell, b: CourseTextCell): boolean {
  if (a.day !== b.day) return true; // different days can't contradict
  const aStart = timeToMinutes(a.start);
  const aEnd = timeToMinutes(a.end);
  const bStart = timeToMinutes(b.start);
  const bEnd = timeToMinutes(b.end);
  // INCLUSIVE comparison, deliberately: one class's cells on the same day
  // are its own tiled grid slots, which ABUT without overlapping
  // ("11:30-11:45AM" + "11:45AM-1PM") — strict overlap would refuse to
  // unify exactly those. Genuinely distinct classes (THAB lecture vs lab)
  // sit minutes-to-hours apart on the shared day, far past mere adjacency.
  return aStart <= bEnd && bStart <= aEnd;
}

function longestSecMember(
  cluster: number[],
  meta: Array<{ key: string; sec: string }>
): number {
  return cluster.reduce(
    (best, j) => (meta[j].sec.length > meta[best].sec.length ? j : best),
    cluster[0]
  );
}

export function canonicalizeCourseVariants<T extends CourseTextCell>(cells: T[]): T[] {
  const meta = cells.map((cell) => {
    const { subject, number, section } = splitCourse(cell.course_raw);
    return {
      key: `${subject.toLowerCase()} ${number.toLowerCase()}`,
      sec: sectionIdentity(section),
    };
  });

  const clusters: number[][] = [];
  for (let i = 0; i < cells.length; i++) {
    if (!meta[i].sec) continue;
    let home = -1;
    for (let c = 0; c < clusters.length && home === -1; c++) {
      const repIdx = longestSecMember(clusters[c], meta);
      if (meta[i].key !== meta[repIdx].key) continue;
      const repSec = meta[repIdx].sec;
      const mySec = meta[i].sec;
      if (!(repSec === mySec || repSec.startsWith(mySec) || mySec.startsWith(repSec))) {
        continue;
      }
      if (!clusters[c].every((j) => timesCompatible(cells[i], cells[j]))) continue;
      home = c;
    }
    if (home === -1) clusters.push([i]);
    else clusters[home].push(i);
  }

  const canonicalOf = new Map<number, string>();
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const repIdx = longestSecMember(cluster, meta);
    for (const j of cluster) {
      if (j !== repIdx) canonicalOf.set(j, cells[repIdx].course_raw);
    }
  }

  return cells.map((cell, i) => {
    const canonical = canonicalOf.get(i);
    return canonical && canonical !== cell.course_raw
      ? { ...cell, course_raw: canonical }
      : cell;
  });
}
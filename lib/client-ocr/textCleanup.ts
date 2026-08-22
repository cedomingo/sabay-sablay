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
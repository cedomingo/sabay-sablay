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
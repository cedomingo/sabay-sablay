/**
 * Single source of truth for subject → color mapping, shared between the
 * personal schedule grid (page.tsx) and the personal Map tab pins.
 *
 * Each entry has Tailwind class names for the grid and a hex value for
 * the Leaflet map pins (which need raw colors, not Tailwind classes).
 */

export interface SubjectColor {
  bg: string;
  text: string;
  border: string;
  hex: string;
}

export const SUBJECT_COLORS: SubjectColor[] = [
  { bg: "bg-[#F4A28C]", text: "text-[#512E2B]", border: "border-[#DC7C66]", hex: "#F4A28C" },
  { bg: "bg-[#8DDDD0]", text: "text-[#163D3A]", border: "border-[#56B9AC]", hex: "#8DDDD0" },
  { bg: "bg-[#C9B9E9]", text: "text-[#34264F]", border: "border-[#A991D1]", hex: "#C9B9E9" },
  { bg: "bg-[#F6D486]", text: "text-[#4C3911]", border: "border-[#DDB35A]", hex: "#F6D486" },
  { bg: "bg-[#D9E7DE]", text: "text-[#286057]", border: "border-[#B9D4C4]", hex: "#D9E7DE" },
];

/**
 * Deterministic color assignment for a subject string. Uses a simple hash
 * so the same subject always gets the same color across grid and map.
 */
export function getColorForSubject(subject: string): SubjectColor {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) {
    hash = subject.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SUBJECT_COLORS[Math.abs(hash) % SUBJECT_COLORS.length];
}

/**
 * Builds a Map<string, SubjectColor> for a list of subjects, preserving
 * insertion order. Use this in both the schedule grid and the Map tab so
 * colors stay in sync.
 */
export function buildSubjectColorMap(subjects: string[]): Map<string, SubjectColor> {
  const map = new Map<string, SubjectColor>();
  subjects.forEach((s) => {
    map.set(s, getColorForSubject(s));
  });
  return map;
}

/**
 * One fixed color per person, cycling if there are more members than
 * swatches, deterministically hashed from user_id. Originally lived inline
 * in GroupScheduleGrid.tsx; pulled out here (Map feature Phase 2) so the
 * Map tab's avatar pins use the exact same color a person already has on
 * the Schedule tab — same visual identity across both views. Same
 * bg/text/border trio approach as the Personal Schedule's subject colors.
 */
export const PERSON_COLORS = [
  { bg: "bg-[#F4A28C]", text: "text-[#512E2B]", border: "border-[#DC7C66]" },
  { bg: "bg-[#8DDDD0]", text: "text-[#163D3A]", border: "border-[#56B9AC]" },
  { bg: "bg-[#C9B9E9]", text: "text-[#34264F]", border: "border-[#A991D1]" },
  { bg: "bg-[#F6D486]", text: "text-[#4C3911]", border: "border-[#DDB35A]" },
  { bg: "bg-[#A8C7EC]", text: "text-[#1C3352]", border: "border-[#6FA8DC]" },
  { bg: "bg-[#F0B8CE]", text: "text-[#5C1F38]", border: "border-[#E294B3]" },
  { bg: "bg-[#B7DCB0]", text: "text-[#254A22]", border: "border-[#7EB57A]" },
  { bg: "bg-[#E3B7AC]", text: "text-[#4A2620]", border: "border-[#C77A68]" },
] as const;

export type PersonColor = (typeof PERSON_COLORS)[number];

// Raw hex pairs matching PERSON_COLORS above, in the same order, for
// contexts that can't use Tailwind classes — e.g. Leaflet DivIcon markup,
// which is raw HTML string injected outside the app's stylesheet scope. Keep
// these in sync with PERSON_COLORS by hand; there are only 8 and they
// change rarely.
export const PERSON_COLORS_HEX = [
  { bg: "#F4A28C", border: "#DC7C66", text: "#512E2B" },
  { bg: "#8DDDD0", border: "#56B9AC", text: "#163D3A" },
  { bg: "#C9B9E9", border: "#A991D1", text: "#34264F" },
  { bg: "#F6D486", border: "#DDB35A", text: "#4C3911" },
  { bg: "#A8C7EC", border: "#6FA8DC", text: "#1C3352" },
  { bg: "#F0B8CE", border: "#E294B3", text: "#5C1F38" },
  { bg: "#B7DCB0", border: "#7EB57A", text: "#254A22" },
  { bg: "#E3B7AC", border: "#C77A68", text: "#4A2620" },
] as const;

/** Deterministic hash of user_id → stable index into the palettes above. */
export function getPersonColorIndex(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % PERSON_COLORS.length;
}

export function getColorForPerson(userId: string): PersonColor {
  return PERSON_COLORS[getPersonColorIndex(userId)];
}

export function getColorForPersonHex(userId: string) {
  return PERSON_COLORS_HEX[getPersonColorIndex(userId)];
}

// Server-only helper for talking to the CRS-Monitor service.
// Never call this from a Client Component.

const BASE_URL = process.env.CRS_MONITOR_API_URL;

export interface CrsSection {
  class_code: string;
  subject: string;
  number: string;
  section: string;
  room: string;
  meeting_times: string;
  available_slots: number;
  total_slots: number;
  demand: number;
  restrictions: string;
  remarks: string;
}

export interface EnrichedEntry {
  subject: string;
  number: string;
  section: string;
  crs_class_code: string | null;
  room: string | null;
  available_slots: number | null;
  total_slots: number | null;
  enrichment_matched: boolean;
}

/**
 * Fetch all sections from CRS-Monitor for the active semester.
 * Batch lookup — one request for all relevant subjects.
 */
export async function fetchSections(): Promise<CrsSection[]> {
  if (!BASE_URL) {
    throw new Error("CRS_MONITOR_API_URL is not set");
  }

  const res = await fetch(`${BASE_URL}/api/sections`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`CRS-Monitor /api/sections failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Enrich a batch of parsed schedule entries against CRS-Monitor data.
 * Matching strategy: join on subject + number + section.
 * Non-blocking: entries that don't match keep nulls.
 */
export async function enrichEntries(
  entries: Array<{ subject: string; number: string; section: string }>
): Promise<EnrichedEntry[]> {
  let sections: CrsSection[] = [];

  try {
    sections = await fetchSections();
  } catch {
    // Non-blocking: if CRS-Monitor is down, return unmatched entries
    return entries.map((e) => ({
      subject: e.subject,
      number: e.number,
      section: e.section,
      crs_class_code: null,
      room: null,
      available_slots: null,
      total_slots: null,
      enrichment_matched: false,
    }));
  }

  // Build a lookup map for fast matching
  const sectionMap = new Map<string, CrsSection>();
  for (const s of sections) {
    const key = `${s.subject}|${s.number}|${s.section}`.toLowerCase();
    sectionMap.set(key, s);
  }

  return entries.map((entry) => {
    const key = `${entry.subject}|${entry.number}|${entry.section}`.toLowerCase();
    const match = sectionMap.get(key);

    if (match) {
      return {
        subject: entry.subject,
        number: entry.number,
        section: entry.section,
        crs_class_code: match.class_code,
        room: match.room,
        available_slots: match.available_slots,
        total_slots: match.total_slots,
        enrichment_matched: true,
      };
    }

    return {
      subject: entry.subject,
      number: entry.number,
      section: entry.section,
      crs_class_code: null,
      room: null,
      available_slots: null,
      total_slots: null,
      enrichment_matched: false,
    };
  });
}

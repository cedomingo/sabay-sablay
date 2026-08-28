/**
 * resolveLocation — pure "where is this person right now" logic for the
 * Map tab. No React, no Supabase calls, no map rendering here; this file
 * takes already-fetched data and current time in, and returns a
 * classification out. See the Map feature build plan, Phase 1.
 *
 * Deliberately has ZERO import dependency on lib/actions/* or Next.js, so
 * it can be unit-tested with a plain `tsx` invocation and never risks
 * pulling `server-only`/Supabase into a client bundle. `ScheduleEntryLike`
 * below is intentionally a standalone shape rather than an import of
 * GroupMemberEntry["entry"] (lib/actions/group-schedule.ts) — keep the two
 * in sync by hand if that shape changes.
 */

import type { Place } from "./data/types";

// ===========================================================================
// Input shapes
// ===========================================================================

/**
 * Mirrors GroupMemberEntry["entry"] in lib/actions/group-schedule.ts (only
 * the fields resolveLocation actually needs). Callers pass ONE member's
 * entries at a time — resolveLocation doesn't know about other members.
 *
 * Note: getGroupSchedule() already filters `.eq("hidden", false)` at the
 * query level, so a hidden entry should simply never appear in the array
 * you pass in here. resolveLocation has no `hidden` field to check and
 * does not re-filter — filtering is the caller's job, same as it already
 * is for every other consumer of getGroupSchedule's output.
 */
export interface ScheduleEntryLike {
  id: string;
  day: string; // "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
  start_minutes: number;
  end_minutes: number;
  room: string | null;
}

/**
 * One row from schedule_entry_location_overrides (Phase 0 migration),
 * shaped for this module. Exactly one of place_name / (custom_lat &&
 * custom_lng) / isAsync should be set — see the migration's header comment.
 */
export interface LocationOverride {
  scheduleEntryId: string;
  placeName: string | null;
  customLat: number | null;
  customLng: number | null;
  customLabel: string | null;
  isAsync: boolean;
  /**
   * UI-only metadata for the Phase 3 TBA-resolution prompt (build plan
   * §A): whether the entry owner dismissed the "where will you actually
   * be?" prompt without resolving it, so it doesn't keep nagging them.
   * resolveLocation() below never reads this field — a dismissed-only row
   * (no placeName/customLat.../isAsync set) already falls through to "no
   * override" on its own, per the comment in the resolver. Optional only
   * because older/synthetic LocationOverride values (tests, Phase 1/2
   * code) never set it.
   */
  dismissedAt?: string | null;
}

// ===========================================================================
// Output shape
// ===========================================================================

export type LocationResult =
  | { state: "in-class"; place: Place; source: "override" | "crs-code" }
  | { state: "in-class-custom-pin"; label: string; lat: number; lng: number }
  | { state: "off-campus" }
  | { state: "building-unresolved"; rawRoom: string };

// ===========================================================================
// Room-string classification
// ===========================================================================

/**
 * Settled no_pin values (handoff §5) — these must never attempt a building
 * lookup and always resolve to the off-campus/free marker. Case-insensitive.
 * Each maps to a `NoPinReason` so callers can tell *which* no-pin case a
 * room string hit — resolveLocation() itself doesn't care (they're all
 * "no-pin" to it), but Phase 3's TBA-resolution prompt (build plan §A)
 * does: it should only ever surface for "tba"/"arranged", never for the
 * already-resolved "asynchronous"/"online"/"empty" cases.
 */
const NO_PIN_REASON: Record<string, NoPinReason> = {
  tba: "tba",
  arranged: "arranged",
  asynchronous: "asynchronous",
  online: "online",
  "": "empty",
};

export type NoPinReason = "tba" | "arranged" | "asynchronous" | "online" | "empty";

export type NormalizedRoom =
  | { kind: "no-pin"; reason: NoPinReason }
  | { kind: "code"; code: string };

/**
 * Classifies a raw `room` string. Exported separately so Phase 3's
 * TBA-prompt UI can reuse the exact same classification (to decide *when*
 * to show the prompt) instead of re-implementing room parsing.
 *
 * Format per the handoff: `<BUILDING-CODE><space><ROOM-NUMBER-AND-SUFFIX>`,
 * e.g. "PH 432", "ALON 203 A", "GUSALI 2-E", "MB 301". The code is
 * whatever precedes the first run of whitespace.
 */
export function normalizeRoom(raw: string | null | undefined): NormalizedRoom {
  const trimmed = (raw ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (lower in NO_PIN_REASON) {
    return { kind: "no-pin", reason: NO_PIN_REASON[lower] };
  }
  // Split on whitespace OR hyphen so that room strings like "AECH-Seminar Rm"
  // correctly extract "AECH" as the building code. No crs_codes in the dataset
  // contain hyphens, so this is safe — see up-diliman-places.json.
  const code = trimmed.split(/[\s-]+/, 1)[0];
  return { kind: "code", code: code.toUpperCase() };
}

/**
 * Whether a raw `room` string is specifically the "TBA"/"Arranged" no-pin
 * case that build plan §A's TBA-resolution prompt should trigger on — as
 * opposed to "Asynchronous"/"Online"/empty, which the student has already
 * effectively resolved (there's no physical room to ask them about) and
 * should never surface the "where will you actually be?" prompt for.
 * Exported so the schedule-view UI (Phase 3) can decide when to render
 * the prompt without re-deriving room classification itself.
 */
export function isTbaPromptable(raw: string | null | undefined): boolean {
  const normalized = normalizeRoom(raw);
  return (
    normalized.kind === "no-pin" &&
    (normalized.reason === "tba" || normalized.reason === "arranged")
  );
}

// ===========================================================================
// Time handling — Asia/Manila, explicit (no reliance on server local time)
// ===========================================================================

const DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Returns the current day (in the app's "Mon".."Sun" convention — see
 * OCR_DAY_TO_CRS_CODE in lib/crs-monitor/matcher.ts) and minutes-since-
 * midnight, both computed in Asia/Manila regardless of what timezone the
 * process itself is running in. Exported for reuse/testing.
 */
export function getManilaDayAndMinutes(now: Date): { day: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday");
  let hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  if (hour === 24) hour = 0; // some ICU implementations emit "24" for midnight
  return { day, minutes: hour * 60 + minute };
}

// kept for potential future use (e.g. "next class today" features) —
// currently unused by resolveLocation itself, which only needs "now".
void DAY_ORDER;

// ===========================================================================
// Active-entry lookup
// ===========================================================================

/**
 * Which of this member's entries (if any) is happening right now, in
 * Asia/Manila time. Exported separately — resolveLocation uses it
 * internally for pin classification, and Phase 2's Map tab click-through
 * (show the person's current class info: subject, room, time) needs the
 * same "what's active right now" answer but wants the raw entry, not just
 * resolveLocation's classification. Keeping one function as the source of
 * truth for "what's active" avoids the two ever disagreeing.
 */
export function findActiveEntry<T extends ScheduleEntryLike>(
  entries: T[],
  now: Date
): T | undefined {
  const { day, minutes } = getManilaDayAndMinutes(now);
  return entries.find(
    (e) => e.day === day && minutes >= e.start_minutes && minutes < e.end_minutes
  );
}

// ===========================================================================
// The resolver
// ===========================================================================

export function resolveLocation(params: {
  entries: ScheduleEntryLike[];
  now: Date;
  places: Place[];
  overrides: LocationOverride[];
}): LocationResult {
  const { entries, now, places, overrides } = params;
  const activeEntry = findActiveEntry(entries, now);

  if (!activeEntry) {
    return { state: "off-campus" };
  }

  const override = overrides.find((o) => o.scheduleEntryId === activeEntry.id);

  if (override) {
    if (override.isAsync) {
      return { state: "off-campus" };
    }
    if (override.placeName) {
      const place = places.find((p) => p.name === override.placeName);
      if (place) {
        return { state: "in-class", place, source: "override" };
      }
      // Override points at a place name that no longer exists in the
      // dataset (e.g. renamed/removed) — fail closed rather than silently
      // dropping the person's real location.
      return { state: "building-unresolved", rawRoom: activeEntry.room ?? "" };
    }
    if (override.customLat != null && override.customLng != null) {
      return {
        state: "in-class-custom-pin",
        label: override.customLabel ?? "Custom location",
        lat: override.customLat,
        lng: override.customLng,
      };
    }
    // Override row exists but has none of the three fields set — treat as
    // no override rather than guessing.
  }

  const normalized = normalizeRoom(activeEntry.room);

  if (normalized.kind === "no-pin") {
    return { state: "off-campus" };
  }

  const place = places.find((p) => p.crs_codes?.includes(normalized.code));
  if (place) {
    return { state: "in-class", place, source: "crs-code" };
  }

  return { state: "building-unresolved", rawRoom: activeEntry.room ?? "" };
}

// ===========================================================================
// Time-independent entry resolver (for the personal Map tab)
// ===========================================================================

/**
 * Resolves a single schedule entry's location without a time gate. Unlike
 * resolveLocation (which answers "where is this person right now?" for the
 * group Map tab), this answers "where does this entry take place?" regardless
 * of the current time — used by the personal Map tab to plot every class on
 * the user's schedule.
 *
 * The resolution logic is identical to the override→normalize→crs-code path
 * in resolveLocation, just applied to a single entry rather than the
 * currently-active one.
 */
export function resolveEntryLocation(params: {
  entry: ScheduleEntryLike;
  places: Place[];
  overrides: LocationOverride[];
}): LocationResult {
  const { entry, places, overrides } = params;

  const override = overrides.find((o) => o.scheduleEntryId === entry.id);

  if (override) {
    if (override.isAsync) {
      return { state: "off-campus" };
    }
    if (override.placeName) {
      const place = places.find((p) => p.name === override.placeName);
      if (place) {
        return { state: "in-class", place, source: "override" };
      }
      return { state: "building-unresolved", rawRoom: entry.room ?? "" };
    }
    if (override.customLat != null && override.customLng != null) {
      return {
        state: "in-class-custom-pin",
        label: override.customLabel ?? "Custom location",
        lat: override.customLat,
        lng: override.customLng,
      };
    }
  }

  const normalized = normalizeRoom(entry.room);

  if (normalized.kind === "no-pin") {
    return { state: "off-campus" };
  }

  const place = places.find((p) => p.crs_codes?.includes(normalized.code));
  if (place) {
    return { state: "in-class", place, source: "crs-code" };
  }

  return { state: "building-unresolved", rawRoom: entry.room ?? "" };
}

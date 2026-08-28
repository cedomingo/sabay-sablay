/**
 * A single pinnable location on the UP Diliman map, from
 * up-diliman-places.json. Static data — not a DB table — so `name` is the
 * de facto stable identifier: schedule_entry_location_overrides.place_name
 * (see the Phase 0 migration) references it directly. Keep names unique
 * when adding new places.
 *
 * `crs_codes` is the set of CRS building-code prefixes (the part of a room
 * string before the room number, e.g. "MB" in "MB 301") that resolve to
 * this place. Omitted when the place has no confirmed/high_confidence code
 * yet (see building-codes-for-verification.json in the handoff docs) — such
 * a place still renders on the map but can never be reached by
 * resolveLocation()'s CRS-code path.
 */
export interface Place {
  name: string;
  lat: number;
  lng: number;
  category: string;
  crs_codes?: string[];
}

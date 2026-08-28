/**
 * Offline verification for lib/map/resolveLocation.ts (Map feature, Phase 1).
 * No test framework in this repo (see scripts/verify-crs-matching.ts for the
 * established pattern) — run with `npx tsx scripts/verify-resolve-location.ts`.
 *
 * resolveLocation has zero Supabase/Next dependency by design, so unlike
 * verify-crs-matching.ts this needs no module stubbing — it's exercised
 * directly against small in-memory fixtures.
 */
import {
  resolveLocation,
  normalizeRoom,
  isTbaPromptable,
  getManilaDayAndMinutes,
  type ScheduleEntryLike,
  type LocationOverride,
} from "../lib/map/resolveLocation";
import type { Place } from "../lib/map/data/types";

const PLACES: Place[] = [
  { name: "Institute of Mathematics (IM)", lat: 14.6485, lng: 121.0715, category: "academic", crs_codes: ["MB"] },
  { name: "Alonso Hall", lat: 14.6522, lng: 121.0731, category: "academic", crs_codes: ["ALON", "CHE", "HRIM", "HRIML", "IDS"] },
];

// A UTC instant that is Friday 08:30 in Asia/Manila (UTC+8).
const FRIDAY_0830_MANILA = new Date("2026-08-28T00:30:00Z");

function entry(overrides: Partial<ScheduleEntryLike> = {}): ScheduleEntryLike {
  return {
    id: "e1",
    day: "Fri",
    start_minutes: 8 * 60,
    end_minutes: 9 * 60,
    room: "MB 301",
    ...overrides,
  };
}

function run() {
  let failures = 0;
  const check = (label: string, cond: boolean, extra?: unknown) => {
    console.log(`[${label}] ${cond ? "PASS" : "FAIL"}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`);
    if (!cond) failures++;
  };

  // 1. No entry active right now.
  {
    const r = resolveLocation({
      entries: [entry({ day: "Mon" })], // wrong day, won't match Friday
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides: [],
    });
    check("1: no active entry -> off-campus", r.state === "off-campus", r);
  }

  // 2. Active entry, room "MB 301", MB in a place's crs_codes -> in-class / crs-code.
  {
    const r = resolveLocation({
      entries: [entry()],
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides: [],
    });
    check(
      "2: MB 301 resolves to Institute of Mathematics via crs-code",
      r.state === "in-class" && r.source === "crs-code" && r.place.name === "Institute of Mathematics (IM)",
      r
    );
  }

  // 3. Active entry, room "TBA", no override -> off-campus.
  {
    const r = resolveLocation({
      entries: [entry({ room: "TBA" })],
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides: [],
    });
    check("3: TBA with no override -> off-campus", r.state === "off-campus", r);
  }

  // 4. Active entry, room "TBA", override with placeName set -> in-class / override.
  {
    const overrides: LocationOverride[] = [
      { scheduleEntryId: "e1", placeName: "Alonso Hall", customLat: null, customLng: null, customLabel: null, isAsync: false },
    ];
    const r = resolveLocation({
      entries: [entry({ room: "TBA" })],
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides,
    });
    check(
      "4: TBA + place override -> in-class via override",
      r.state === "in-class" && r.source === "override" && r.place.name === "Alonso Hall",
      r
    );
  }

  // 5. Active entry, room "TBA", override isAsync -> off-campus.
  {
    const overrides: LocationOverride[] = [
      { scheduleEntryId: "e1", placeName: null, customLat: null, customLng: null, customLabel: null, isAsync: true },
    ];
    const r = resolveLocation({
      entries: [entry({ room: "TBA" })],
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides,
    });
    check("5: TBA + isAsync override -> off-campus", r.state === "off-campus", r);
  }

  // 6. Active entry, override with a custom pin -> in-class-custom-pin.
  {
    const overrides: LocationOverride[] = [
      { scheduleEntryId: "e1", placeName: null, customLat: 14.65, customLng: 121.07, customLabel: "My study spot", isAsync: false },
    ];
    const r = resolveLocation({
      entries: [entry({ room: "TBA" })],
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides,
    });
    check(
      "6: custom pin override -> in-class-custom-pin",
      r.state === "in-class-custom-pin" && r.label === "My study spot" && r.lat === 14.65 && r.lng === 121.07,
      r
    );
  }

  // 7. Well-formed but unknown building prefix, no override -> building-unresolved.
  {
    const r = resolveLocation({
      entries: [entry({ room: "ZZZ 404" })],
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides: [],
    });
    check(
      "7: unknown prefix -> building-unresolved",
      r.state === "building-unresolved" && r.rawRoom === "ZZZ 404",
      r
    );
  }

  // 8. CHE/MB ambiguity (handoff §5): a raw room string with both prefixes
  //    co-occurring should not silently resolve to either building. Our
  //    parser only ever reads the FIRST whitespace-delimited token as the
  //    code, so "CHE MB 102" parses as code "CHE" (Alonso Hall) — not a
  //    misresolution to MB, but flag explicitly: this is a real limitation
  //    the CRS-Monitor room-extraction step is responsible for resolving
  //    upstream (per handoff §6 item 3), not something resolveLocation can
  //    fix by guessing harder. Assert it resolves to exactly one place, not
  //    a crash or a match on the wrong code embedded later in the string.
  {
    const r = resolveLocation({
      entries: [entry({ room: "CHE MB 102" })],
      now: FRIDAY_0830_MANILA,
      places: PLACES,
      overrides: [],
    });
    check(
      "8: CHE/MB co-occurring string resolves to first token (CHE) only, not MB",
      r.state === "in-class" && r.source === "crs-code" && r.place.name === "Alonso Hall",
      r
    );
  }

  // 9. Multiple schedule blocks for the same subject; only the block whose
  //    time window contains `now` should be evaluated.
  {
    const entries: ScheduleEntryLike[] = [
      { id: "e1", day: "Thu", start_minutes: 7 * 60, end_minutes: 8 * 60, room: "TBA" },
      { id: "e2", day: "Fri", start_minutes: 7 * 60, end_minutes: 9 * 60, room: "MB 301" },
    ];
    const r = resolveLocation({
      entries,
      now: FRIDAY_0830_MANILA, // Friday 08:30 -> should hit e2, not e1
      places: PLACES,
      overrides: [],
    });
    check(
      "9: correct block picked when multiple blocks exist",
      r.state === "in-class" && r.source === "crs-code" && r.place.name === "Institute of Mathematics (IM)",
      r
    );
  }

  // 10. normalizeRoom classification sanity, including case-insensitivity.
  {
    const cases: Array<[string | null, "no-pin" | "code"]> = [
      ["TBA", "no-pin"],
      ["tba", "no-pin"],
      ["Arranged", "no-pin"],
      ["Asynchronous", "no-pin"],
      ["Online", "no-pin"],
      ["", "no-pin"],
      [null, "no-pin"],
      ["MB 301", "code"],
      ["ALON 203 A", "code"],
    ];
    const ok = cases.every(([raw, expected]) => normalizeRoom(raw).kind === expected);
    check("10: normalizeRoom classification", ok, cases.map(([raw]) => [raw, normalizeRoom(raw)]));
  }

  // 11. getManilaDayAndMinutes matches expected day/time regardless of
  //     process timezone (sanity check against a known UTC instant).
  {
    const { day, minutes } = getManilaDayAndMinutes(FRIDAY_0830_MANILA);
    check("11: getManilaDayAndMinutes -> Fri 08:30", day === "Fri" && minutes === 8 * 60 + 30, { day, minutes });
  }

  // 12. isTbaPromptable (Phase 3, build plan §A): true for TBA/Arranged
  //     only, never for the already-resolved Asynchronous/Online/empty
  //     no-pin cases, and never for a real room code.
  {
    const cases: Array<[string | null, boolean]> = [
      ["TBA", true],
      ["tba", true],
      ["Arranged", true],
      ["Asynchronous", false],
      ["Online", false],
      ["", false],
      [null, false],
      ["MB 301", false],
    ];
    const ok = cases.every(([raw, expected]) => isTbaPromptable(raw) === expected);
    check(
      "12: isTbaPromptable only fires for TBA/Arranged",
      ok,
      cases.map(([raw]) => [raw, isTbaPromptable(raw)])
    );
  }

  // 13. normalizeRoom's `reason` field distinguishes the no-pin cases
  //     underneath the shared "no-pin" kind.
  {
    const r1 = normalizeRoom("TBA");
    const r2 = normalizeRoom("Arranged");
    const r3 = normalizeRoom("Online");
    check(
      "13: normalizeRoom reason field",
      r1.kind === "no-pin" &&
        r1.reason === "tba" &&
        r2.kind === "no-pin" &&
        r2.reason === "arranged" &&
        r3.kind === "no-pin" &&
        r3.reason === "online",
      { r1, r2, r3 }
    );
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  if (failures > 0) process.exit(1);
}

run();

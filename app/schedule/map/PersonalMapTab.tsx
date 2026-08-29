"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import {
  MapPin,
  Clock,
  X,
  Radio,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { ScheduleEntry } from "../page";
import {
  resolveEntryLocation,
  findActiveEntry,
  type LocationResult,
  type LocationOverride,
  type ScheduleEntryLike,
} from "@/lib/map/resolveLocation";
import type { Place } from "@/lib/map/data/types";
import placesData from "@/lib/map/data/up-diliman-places.json";
import { buildSubjectColorMap } from "@/lib/map/subjectColors";
import BuildingSubmissionPrompt from "@/app/groups/[groupId]/map/BuildingSubmissionPrompt";
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  CAMPUS_CENTER,
  CAMPUS_DEFAULT_ZOOM,
  usingFallbackTiles,
} from "@/lib/map/tileConfig";

const places = placesData as Place[];

// Clustering: entries at the same coordinate are shingled slightly apart
const STACK_STEP_LAT_DEG = -0.00004;
const STACK_STEP_LNG_DEG = 0.00005;
const STACK_MIN_SCALE = 0.72;
const STACK_SCALE_STEP = 0.1;

interface Props {
  entries: ScheduleEntry[];
  overrides: LocationOverride[];
}

/** Where a resolved location plots on the map, if at all. */
function getPinCoords(
  location: LocationResult
): { lat: number; lng: number; label: string } | null {
  if (location.state === "in-class") {
    return {
      lat: location.place.lat,
      lng: location.place.lng,
      label: location.place.name,
    };
  }
  if (location.state === "in-class-custom-pin") {
    return { lat: location.lat, lng: location.lng, label: location.label };
  }
  return null;
}

function describeLocation(location: LocationResult): {
  label: string;
  tone: "pinned" | "off" | "unresolved";
} {
  switch (location.state) {
    case "in-class":
      return { label: location.place.name, tone: "pinned" };
    case "in-class-custom-pin":
      return { label: location.label, tone: "pinned" };
    case "off-campus":
      return { label: "Off campus / free", tone: "off" };
    case "building-unresolved":
      return {
        label: `Building not on map yet${location.rawRoom ? ` (${location.rawRoom})` : ""}`,
        tone: "unresolved",
      };
  }
}

/** Extract just "TBA" or "Arranged" from room strings like "PE TBA" */
function getTbaDisplay(room: string | null | undefined): string | null {
  if (!room) return null;
  const trimmed = room.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "tba" || lower === "arranged") return trimmed;
  const match = lower.match(/\b(tba|arranged)$/);
  if (match) return match[1].toUpperCase();
  return null;
}

/** Build a Leaflet divIcon for a subject-colored pin marker. */
function buildMarkerHtml(
  color: { hex: string; border: string },
  isActive: boolean,
  stack?: { scale: number; badgeCount?: number }
) {
  const scale = stack?.scale ?? 1;
  const size = Math.round(34 * scale);
  const offset = Math.round((34 - size) / 2);
  const borderColor = isActive ? "#214746" : color.border;
  const borderWidth = isActive ? 3 : 2.5;
  const pulseRing = isActive
    ? `<div style="position:absolute;top:${offset - 4}px;left:${offset - 4}px;width:${size + 8}px;height:${size + 8}px;border-radius:9999px;border:2px solid #214746;animation:pulse-ring 1.5s ease-out infinite;pointer-events:none;"></div>`
    : "";
  const badge = stack?.badgeCount
    ? `<div style="position:absolute;top:-2px;right:-2px;z-index:2;min-width:16px;height:16px;padding:0 3px;border-radius:9999px;background:#214746;border:2px solid #F8F6F0;display:flex;align-items:center;justify-content:center;font:700 9px 'DM Sans',sans-serif;color:#F4F1E9;">${stack.badgeCount}</div>`
    : "";
  return `<div style="position:relative;width:34px;height:34px;">
    ${pulseRing}
    <div style="position:absolute;top:${offset}px;left:${offset}px;width:${size}px;height:${size}px;border-radius:9999px;background:${color.hex};border:${borderWidth}px solid ${borderColor};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(33,71,70,.35);overflow:hidden;cursor:pointer;opacity:${scale < 1 ? 0.92 : 1};">
      <svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(14 * scale)}" height="${Math.round(14 * scale)}" viewBox="0 0 24 24" fill="none" stroke="#214746" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
    </div>${badge}</div>`;
}

// ---------------------------------------------------------------------------
// Sidebar types
// ---------------------------------------------------------------------------

interface CourseGroup {
  subject: string;
  number: string;
  entries: ScheduleEntry[];
  resolvedEntries: ResolvedEntry[];
  hasActive: boolean;
  color: { hex: string; border: string } | undefined;
}

interface BuildingGroup {
  label: string;
  tone: "pinned" | "off" | "unresolved";
  lat: number;
  lng: number;
  courses: CourseGroup[];
  hasActive: boolean;
  color: { hex: string; border: string } | undefined;
}

interface ResolvedEntry {
  entry: ScheduleEntry;
  location: LocationResult;
  color: { hex: string; border: string } | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PersonalMapTab({ entries, overrides }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").Marker[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  // Keep now ticking so the "active" highlight updates client-side
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 45_000);
    return () => clearInterval(id);
  }, []);

  // Deduplicate entries by id
  const uniqueEntries = useMemo(() => {
    const seen = new Set<string>();
    return entries.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [entries]);

  // Map entries to ScheduleEntryLike shape for resolveEntryLocation
  const entriesLike = useMemo(() => {
    return uniqueEntries.map(
      (e): ScheduleEntryLike => ({
        id: e.id,
        day: e.day,
        start_minutes: e.start_minutes,
        end_minutes: e.end_minutes,
        room: e.room,
      })
    );
  }, [uniqueEntries]);

  // Resolve every entry's location
  const resolved: ResolvedEntry[] = useMemo(() => {
    const subjectColorMap = buildSubjectColorMap([
      ...new Set(uniqueEntries.map((e) => e.subject)),
    ]);

    return uniqueEntries
      .filter((e) => !e.hidden)
      .map((entry) => {
        const entryLike = entriesLike.find((el) => el.id === entry.id)!;
        const location = resolveEntryLocation({
          entry: entryLike,
          places,
          overrides,
        });
        const color = subjectColorMap.get(entry.subject);
        return { entry, location, color };
      });
  }, [uniqueEntries, entriesLike, overrides]);

  // Determine which entry is currently active
  const activeEntryId = useMemo(() => {
    const active = findActiveEntry(entriesLike, now);
    return active?.id ?? null;
  }, [entriesLike, now]);

  // Cluster pinned entries by coordinate, then shingle
  const pinned = useMemo(() => {
    const buckets = new Map<
      string,
      Array<
        ResolvedEntry & { lat: number; lng: number; label: string }
      >
    >();
    for (const r of resolved) {
      const coords = getPinCoords(r.location);
      if (!coords) continue;
      const key = `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
      const arr = buckets.get(key) ?? [];
      arr.push({ ...r, ...coords });
      buckets.set(key, arr);
    }

    const out: Array<{
      entry: ScheduleEntry;
      location: LocationResult;
      color: { hex: string; border: string } | undefined;
      lat: number;
      lng: number;
      stackIndex: number;
      stackSize: number;
    }> = [];
    for (const group of buckets.values()) {
      group.forEach((r, i) => {
        out.push({
          entry: r.entry,
          location: r.location,
          color: r.color,
          lat: r.lat + STACK_STEP_LAT_DEG * i,
          lng: r.lng + STACK_STEP_LNG_DEG * i,
          stackIndex: i,
          stackSize: group.length,
        });
      });
    }
    return out;
  }, [resolved]);

  // Init the Leaflet map once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: CAMPUS_CENTER,
        zoom: CAMPUS_DEFAULT_ZOOM,
      });
      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: TILE_MAX_ZOOM,
      }).addTo(map);

      mapRef.current = map;
      setLeafletReady(true);

      const containerEl = mapContainerRef.current;
      const resizeObserver = new ResizeObserver(() => {
        mapRef.current?.invalidateSize();
      });
      resizeObserver.observe(containerEl);
      resizeObserverRef.current = resizeObserver;

      requestAnimationFrame(() => mapRef.current?.invalidateSize());
    })();

    return () => {
      cancelled = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers whenever the resolved pin set changes
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;

      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      for (const p of pinned) {
        const isActive = p.entry.id === activeEntryId;
        const color = p.color ?? { hex: "#F4A28C", border: "#DC7C66" };
        const isFrontOfStack = p.stackIndex === p.stackSize - 1;
        const scale = Math.max(
          STACK_MIN_SCALE,
          1 - p.stackIndex * STACK_SCALE_STEP
        );
        const icon = L.divIcon({
          className: "",
          html: buildMarkerHtml(color, isActive, {
            scale,
            badgeCount:
              isFrontOfStack && p.stackSize > 1 ? p.stackSize : undefined,
          }),
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const marker = L.marker([p.lat, p.lng], {
          icon,
          zIndexOffset: isActive ? 1000 : p.stackIndex * 10,
        }).addTo(mapRef.current);
        marker.on("click", () => setSelectedEntryId(p.entry.id));
        markersRef.current.push(marker);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pinned, leafletReady, activeEntryId]);

  // Fly-to helper — pans/zooms the map to a coordinate
  const flyTo = useCallback((lat: number, lng: number) => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter();
    const currentZoom = mapRef.current.getZoom();
    const distance = center.distanceTo({ lat, lng });
    const zoomDiff = Math.abs(currentZoom - 17);
    if (distance < 50 && zoomDiff < 0.5) return;
    mapRef.current.flyTo([lat, lng], 17, { duration: 0.8 });
  }, []);

  // -------------------------------------------------------------------------
  // Two-level sidebar grouping: Building > Course (subject+number) > entries
  // Same building + same subject+number = 1 course, even with different rooms.
  // -------------------------------------------------------------------------
  const buildingGroups: BuildingGroup[] = useMemo(() => {
    const buildingMap = new Map<string, BuildingGroup>();
    for (const r of resolved) {
      const { label, tone } = describeLocation(r.location);
      const coords = getPinCoords(r.location);
      let building = buildingMap.get(label);
      if (!building) {
        building = {
          label,
          tone,
          lat: coords?.lat ?? 0,
          lng: coords?.lng ?? 0,
          courses: [],
          hasActive: false,
          color: r.color,
        };
        buildingMap.set(label, building);
      }
      if (r.entry.id === activeEntryId) building.hasActive = true;

      // Within a building, group by subject+number (course identity)
      let course = building.courses.find(
        (c) =>
          c.subject === r.entry.subject && c.number === r.entry.number
      );
      if (!course) {
        course = {
          subject: r.entry.subject,
          number: r.entry.number,
          entries: [],
          resolvedEntries: [],
          hasActive: false,
          color: r.color,
        };
        building.courses.push(course);
      }
      course.entries.push(r.entry);
      course.resolvedEntries.push(r);
      if (r.entry.id === activeEntryId) course.hasActive = true;
    }
    return [...buildingMap.values()];
  }, [resolved, activeEntryId]);

  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(
    new Set()
  );
  const toggleBuilding = useCallback((label: string) => {
    setExpandedBuildings((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const selected = selectedEntryId
    ? resolved.find((r) => r.entry.id === selectedEntryId) ?? null
    : null;

  return (
    <div className="space-y-4">
      {usingFallbackTiles && (
        <p className="rounded-xl border border-[#DDB35A]/40 bg-[#FBF2D9] px-3 py-2 text-xs text-[#4C3911]">
          Using OpenStreetMap&apos;s public tiles for local development. Set{" "}
          <code className="font-mono">NEXT_PUBLIC_MAPTILER_KEY</code> before
          deploying.
        </p>
      )}

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="relative overflow-hidden rounded-[22px] border border-[#D0CEC4] shadow-card">
          <div
            ref={mapContainerRef}
            className="h-[420px] w-full md:h-[520px]"
          />
          {!leafletReady && (
            <div className="absolute inset-0 grid place-items-center bg-[#F8F6F0]">
              <p className="text-xs text-[#87908A]">Loading map…</p>
            </div>
          )}

          {selected && (
            <SelectedInfoPanel
              entry={selected.entry}
              location={selected.location}
              color={selected.color}
              isActive={selected.entry.id === activeEntryId}
              onClose={() => setSelectedEntryId(null)}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="max-h-[520px] overflow-y-auto rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-4">
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-[#A991D1]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
              All classes
            </p>
          </div>
          <div className="mt-3 space-y-1">
            {buildingGroups.map((building) => {
              const isExpanded = expandedBuildings.has(building.label);
              const totalEntries = building.courses.reduce(
                (n, c) => n + c.entries.length,
                0
              );
              const pinColor = building.color ?? {
                hex: "#F4A28C",
                border: "#DC7C66",
              };
              return (
                <div key={building.label} className="rounded-xl">
                  {/* Building header — expand/collapse + pan */}
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => toggleBuilding(building.label)}
                      className="mt-0.5 shrink-0 grid h-6 w-6 place-items-center rounded-lg text-[#87908A] hover:bg-white/60"
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (building.tone === "pinned")
                          flyTo(building.lat, building.lng);
                      }}
                      className="min-w-0 flex-1 py-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: pinColor.hex,
                            border: `1.5px solid ${pinColor.border}`,
                          }}
                        />
                        <span className="truncate text-xs font-semibold text-[#214746]">
                          {building.label}
                          {building.hasActive && (
                            <span className="ml-1 rounded-full bg-[#D9E7DE] px-1.5 py-0.5 text-[9px] font-bold text-[#286057]">
                              NOW
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="ml-[22px] block text-[10px] text-[#87908A]">
                        {building.courses.length}{" "}
                        {building.courses.length === 1
                          ? "course"
                          : "courses"}{" "}
                        · {totalEntries}{" "}
                        {totalEntries === 1 ? "class" : "classes"}
                      </span>
                    </button>
                  </div>

                  {/* Expanded: courses under this building */}
                  {isExpanded && (
                    <div className="ml-4 mt-0.5 space-y-1 border-l border-[#D8D6CD] pl-3">
                      {building.courses.map((course) => {
                        const courseColor = course.color ?? {
                          hex: "#F4A28C",
                          border: "#DC7C66",
                        };
                        return (
                          <div
                            key={`${course.subject}|${course.number}`}
                          >
                            {/* Course header */}
                            <button
                              type="button"
                              onClick={() => {
                                if (building.tone === "pinned")
                                  flyTo(building.lat, building.lng);
                                setSelectedEntryId(
                                  course.entries[0].id
                                );
                              }}
                              className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-white/60"
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  background: courseColor.hex,
                                  border: `1px solid ${courseColor.border}`,
                                }}
                              />
                              <span className="truncate text-[11px] font-semibold text-[#214746]">
                                {course.subject} {course.number}
                                {course.hasActive && (
                                  <span className="ml-1 rounded-full bg-[#D9E7DE] px-1 py-px text-[8px] font-bold text-[#286057]">
                                    NOW
                                  </span>
                                )}
                              </span>
                            </button>
                            {/* Individual schedule entries */}
                            <div className="ml-4 space-y-0.5">
                              {course.resolvedEntries.map((r) => (
                                <button
                                  key={r.entry.id}
                                  type="button"
                                  onClick={() =>
                                    setSelectedEntryId(r.entry.id)
                                  }
                                  className={`flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10px] hover:bg-white/60 ${
                                    selectedEntryId === r.entry.id
                                      ? "bg-white font-semibold text-[#214746]"
                                      : "text-[#717972]"
                                  }`}
                                >
                                  <span>{r.entry.day}</span>
                                  <span className="text-[#B9BDB4]">
                                    ·
                                  </span>
                                  <span>
                                    {r.entry.start_display}–
                                    {r.entry.end_display}
                                  </span>
                                  {r.entry.room && (
                                    <>
                                      <span className="text-[#B9BDB4]">
                                        ·
                                      </span>
                                      <span className="truncate text-[#87908A]">
                                        {getTbaDisplay(r.entry.room) ?? r.entry.room}
                                      </span>
                                    </>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {buildingGroups.length === 0 && (
              <p className="px-1 py-2 text-xs text-[#87908A]">
                No classes to show yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedInfoPanel({
  entry,
  location,
  color,
  isActive,
  onClose,
}: {
  entry: ScheduleEntry;
  location: LocationResult;
  color: { hex: string; border: string } | undefined;
  isActive: boolean;
  onClose: () => void;
}) {
  const { label, tone } = describeLocation(location);

  return (
    <div className="absolute bottom-3 left-3 right-3 z-[500] rounded-2xl border border-[#D0CEC4] bg-white/95 p-4 shadow-elevated backdrop-blur-sm md:left-3 md:right-auto md:w-80">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#214746]">
            {entry.subject} {entry.number}
            {entry.section && (
              <span className="ml-1 text-xs font-normal text-[#87908A]">
                {entry.section}
              </span>
            )}
          </p>
          <p
            className={`mt-0.5 flex items-center gap-1 text-xs ${
              tone === "pinned"
                ? "text-[#286057]"
                : tone === "unresolved"
                  ? "text-[#8A6A1F]"
                  : "text-[#87908A]"
            }`}
          >
            <MapPin size={11} />
            {label}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#87908A] hover:bg-[#F4F1E9]"
        >
          <X size={13} />
        </button>
      </div>

      {location.state === "building-unresolved" && (
        <div className="mt-3 rounded-xl border border-[#DDB35A]/50 bg-[#FBF2D9] p-3">
          <p className="flex items-start gap-2 text-xs text-[#8A6A1F]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Your building seems to be missing on our map. Please help us
              add it!
            </span>
          </p>
          <BuildingSubmissionPrompt
            rawRoom={location.rawRoom}
            isOwnLocation={true}
          />
        </div>
      )}

      <div className="mt-3 border-t border-[#E1DFD7] pt-3">
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="rounded-full bg-[#D9E7DE] px-1.5 py-0.5 text-[9px] font-bold text-[#286057]">
              CURRENT
            </span>
          )}
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-[#717972]">
          <Clock size={11} />
          {entry.start_display}–{entry.end_display}
        </p>
        <p className="mt-1 text-xs text-[#717972]">
          Room: {entry.room && entry.room.trim() ? (getTbaDisplay(entry.room) ?? entry.room) : "—"}
        </p>
        <p className="mt-1 text-xs text-[#87908A]">{entry.day}</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapPin, Clock, X, Radio, AlertTriangle, Users } from "lucide-react";
import type { GroupMemberEntry } from "@/lib/actions/group-schedule";
import {
  resolveLocation,
  findActiveEntry,
  getOverrideDisplayRoom,
  type LocationResult,
  type LocationOverride,
  type ScheduleEntryLike,
} from "@/lib/map/resolveLocation";
import type { Place } from "@/lib/map/data/types";
import placesData from "@/lib/map/data/up-diliman-places.json";
import { getColorForPersonHex } from "@/lib/map/personColors";
import BuildingSubmissionPrompt from "./BuildingSubmissionPrompt";
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  CAMPUS_CENTER,
  CAMPUS_DEFAULT_ZOOM,
  usingFallbackTiles,
} from "@/lib/map/tileConfig";

const places = placesData as Place[];

// Client-side recompute only (build plan Phase 2) — no new backend calls,
// just re-running resolveLocation against data we already fetched.
const RECOMPUTE_INTERVAL_MS = 45_000;

// Build plan Phase 6 decision: stacked avatars, not a count-only badge.
// Members sharing a pin render as a shingled stack (each one a few meters
// off from the true coordinate, in a fixed down-right direction) — the
// frontmost/topmost avatar is full size, earlier ones shrink and fade
// slightly to read as "behind" it, and the frontmost gets a small count
// badge when the stack has more than one person. Every avatar keeps its
// own coordinate and its own click target (selects that member), so this
// stays consistent with the roster list and SelectedInfoPanel — it's a
// visual treatment, not a grouped/aggregate marker.
const STACK_STEP_LAT_DEG = -0.00004;
const STACK_STEP_LNG_DEG = 0.00005;
const STACK_MIN_SCALE = 0.72;
const STACK_SCALE_STEP = 0.1;

interface Member {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
}

interface Props {
  members: Member[];
  entries: GroupMemberEntry[];
  overrides: LocationOverride[];
  currentUserId: string;
}

function getInitials(fullName: string) {
  return fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]
  );
}

/** Where a resolved location actually plots on the physical map, if it does at all. */
function getPinCoords(location: LocationResult): { lat: number; lng: number; label: string } | null {
  if (location.state === "in-class") {
    return { lat: location.place.lat, lng: location.place.lng, label: location.place.name };
  }
  if (location.state === "in-class-custom-pin") {
    return { lat: location.lat, lng: location.lng, label: location.label };
  }
  return null;
}

/**
 * Text + visual "tone" for a resolved location, used by the roster list.
 * Only "pinned" locations also get a marker on the map itself — off-campus
 * and building-unresolved states have no coordinates to plot, so they're
 * represented here instead, with their own distinct styling, rather than
 * invented pin positions (build plan Phase 2's "distinct visual treatment
 * for the three states" requirement).
 */
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

/**
 * Renders one avatar marker. `stack` is present when this member shares a
 * coordinate with others (Phase 6 clustering decision, see
 * STACK_STEP_LAT_DEG doc comment above) — it shrinks/fades non-frontmost
 * avatars and puts a count badge on the frontmost one.
 */
function buildMarkerHtml(
  member: Member,
  color: { bg: string; border: string; text: string },
  stack?: { scale: number; badgeCount?: number }
) {
  const initials = getInitials(member.full_name);
  const scale = stack?.scale ?? 1;
  const size = Math.round(34 * scale);
  const offset = Math.round((34 - size) / 2);
  const inner = member.avatar_url
    ? `<img src="${escapeHtml(member.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;" />`
    : `<span style="font:700 ${Math.round(11 * scale)}px 'DM Sans',sans-serif;color:${color.text};">${escapeHtml(initials)}</span>`;
  const badge = stack?.badgeCount
    ? `<div style="position:absolute;top:-2px;right:-2px;z-index:2;min-width:16px;height:16px;padding:0 3px;border-radius:9999px;background:#214746;border:2px solid #F8F6F0;display:flex;align-items:center;justify-content:center;font:700 9px 'DM Sans',sans-serif;color:#F4F1E9;">${stack.badgeCount}</div>`
    : "";
  return `<div style="position:relative;width:34px;height:34px;">
    <div style="position:absolute;top:${offset}px;left:${offset}px;width:${size}px;height:${size}px;border-radius:9999px;background:${color.bg};border:2.5px solid ${color.border};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(33,71,70,.35);overflow:hidden;cursor:pointer;opacity:${scale < 1 ? 0.92 : 1};">${inner}</div>${badge}</div>`;
}

export default function MapTab({ members, entries, overrides, currentUserId }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").Marker[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), RECOMPUTE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Group already-fetched entries by member, trimmed to what resolveLocation needs.
  const entriesByUser = useMemo(() => {
    const map = new Map<string, ScheduleEntryLike[]>();
    for (const m of members) map.set(m.user_id, []);
    for (const me of entries) {
      const list = map.get(me.user_id);
      if (list) {
        list.push({
          id: me.entry.id,
          day: me.entry.day,
          start_minutes: me.entry.start_minutes,
          end_minutes: me.entry.end_minutes,
          room: me.entry.room,
        });
      }
    }
    return map;
  }, [members, entries]);

  // Full course detail per entry id (subject/number/section/times/room) —
  // resolveLocation only needs the trimmed shape above, but the
  // click-through info panel wants the rest.
  const entryDetailById = useMemo(() => {
    const map = new Map<string, GroupMemberEntry["entry"]>();
    for (const me of entries) map.set(me.entry.id, me.entry);
    return map;
  }, [entries]);

  const resolved = useMemo(() => {
    return members.map((member) => {
      const memberEntries = entriesByUser.get(member.user_id) ?? [];
      const location = resolveLocation({ entries: memberEntries, now, places, overrides });
      const activeEntry = findActiveEntry(memberEntries, now);
      const activeDetail = activeEntry ? entryDetailById.get(activeEntry.id) ?? null : null;
      const activeOverride = activeEntry
        ? overrides.find((o) => o.scheduleEntryId === activeEntry.id) ?? null
        : null;
      const activeDetailRoom = activeDetail
        ? getOverrideDisplayRoom({
            rawRoom: activeDetail.room,
            override: activeOverride,
            places,
          })
        : null;
      return { member, location, activeDetail, activeDetailRoom };
    });
  }, [members, entriesByUser, entryDetailById, now, overrides]);

  const resolvedByUserId = useMemo(() => {
    const map = new Map<string, (typeof resolved)[number]>();
    for (const r of resolved) map.set(r.member.user_id, r);
    return map;
  }, [resolved]);

  // Bucket "pinned" members by coordinate, then arrange each bucket into a
  // shingled stack — see STACK_STEP_LAT_DEG doc comment above for the
  // Phase 6 clustering decision.
  const pinned = useMemo(() => {
    const buckets = new Map<string, Array<(typeof resolved)[number] & { lat: number; lng: number; label: string }>>();
    for (const r of resolved) {
      const coords = getPinCoords(r.location);
      if (!coords) continue;
      const key = `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
      const arr = buckets.get(key) ?? [];
      arr.push({ ...r, ...coords });
      buckets.set(key, arr);
    }

    const out: Array<{
      member: Member;
      location: LocationResult;
      activeDetail: GroupMemberEntry["entry"] | null;
      lat: number;
      lng: number;
      stackIndex: number;
      stackSize: number;
    }> = [];
    for (const group of buckets.values()) {
      group.forEach((r, i) => {
        out.push({
          member: r.member,
          location: r.location,
          activeDetail: r.activeDetail,
          lat: r.lat + STACK_STEP_LAT_DEG * i,
          lng: r.lng + STACK_STEP_LNG_DEG * i,
          stackIndex: i,
          stackSize: group.length,
        });
      });
    }
    return out;
  }, [resolved]);

  // Init the Leaflet map once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: CAMPUS_CENTER,
        zoom: CAMPUS_DEFAULT_ZOOM,
        attributionControl: false,
      });
      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: TILE_MAX_ZOOM,
      }).addTo(map);

      mapRef.current = map;
      setLeafletReady(true);

      // Leaflet caches its container's pixel size at the instant L.map()
      // runs. If the grid/flex layout (or Tailwind's CSS) hasn't finished
      // settling yet — which is common in dev under React Strict Mode's
      // double-effect — that cached size can be wrong, producing exactly
      // one tile in a corner with the rest of the box blank. A
      // ResizeObserver keeps the map's internal size in sync with the
      // container's real size going forward.
      const containerEl = mapContainerRef.current;
      const resizeObserver = new ResizeObserver(() => {
        mapRef.current?.invalidateSize();
      });
      resizeObserver.observe(containerEl);
      resizeObserverRef.current = resizeObserver;

      // Also correct for the very first paint, in case the observer's
      // first callback fires after the initial mis-sized render.
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

  // Sync markers whenever the resolved pin set changes.
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;

      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      for (const p of pinned) {
        const color = getColorForPersonHex(p.member.user_id);
        const isFrontOfStack = p.stackIndex === p.stackSize - 1;
        const scale = Math.max(STACK_MIN_SCALE, 1 - p.stackIndex * STACK_SCALE_STEP);
        const icon = L.divIcon({
          className: "",
          html: buildMarkerHtml(p.member, color, {
            scale,
            badgeCount: isFrontOfStack && p.stackSize > 1 ? p.stackSize : undefined,
          }),
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        // Later stack members render behind visually (smaller/faded), so
        // give them a lower z so the frontmost avatar's badge/click target
        // is never covered by one "behind" it.
        const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: p.stackIndex * 10 }).addTo(
          mapRef.current
        );
        marker.on("click", () => setSelectedUserId(p.member.user_id));
        markersRef.current.push(marker);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pinned, leafletReady]);

  const selected = selectedUserId ? resolvedByUserId.get(selectedUserId) ?? null : null;

  return (
    <div className="space-y-4">
      {usingFallbackTiles && (
        <p className="rounded-xl border border-[#DDB35A]/40 bg-[#FBF2D9] px-3 py-2 text-xs text-[#4C3911]">
          Using OpenStreetMap&apos;s public tiles for local development. Set{" "}
          <code className="font-mono">NEXT_PUBLIC_MAPTILER_KEY</code> before deploying — see{" "}
          <code className="font-mono">lib/map/tileConfig.ts</code>.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="relative overflow-hidden rounded-[22px] border border-[#D0CEC4] shadow-card">
          <div ref={mapContainerRef} className="h-[420px] w-full md:h-[520px]" />
          {!leafletReady && (
            <div className="absolute inset-0 grid place-items-center bg-[#F8F6F0]">
              <p className="text-xs text-[#87908A]">Loading map…</p>
            </div>
          )}

          {selected && (
            <SelectedInfoPanel
              member={selected.member}
              location={selected.location}
              activeDetail={selected.activeDetail}
              activeDetailRoom={selected.activeDetailRoom}
              isOwnLocation={selected.member.user_id === currentUserId}
              onClose={() => setSelectedUserId(null)}
            />
          )}
        </div>

        <div className="rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-4">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-[#A991D1]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#87908A]">
              Right now
            </p>
          </div>
          <div className="mt-3 space-y-1.5">
            {resolved.map(({ member, location }) => {
              const { label, tone } = describeLocation(location);
              const color = getColorForPersonHex(member.user_id);
              return (
                <button
                  key={member.user_id}
                  type="button"
                  onClick={() => setSelectedUserId(member.user_id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    selectedUserId === member.user_id
                      ? "border-[#214746] bg-white"
                      : "border-transparent hover:bg-white/60"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color.bg, border: `1.5px solid ${color.border}` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-[#214746]">
                      {member.full_name}
                      {member.user_id === currentUserId && (
                        <span className="ml-1 font-normal text-[#87908A]">(you)</span>
                      )}
                    </span>
                    <span
                      className={`mt-0.5 flex items-center gap-1 truncate text-[11px] ${
                        tone === "pinned"
                          ? "text-[#286057]"
                          : tone === "unresolved"
                          ? "text-[#8A6A1F]"
                          : "text-[#87908A]"
                      }`}
                    >
                      {tone === "pinned" && <MapPin size={10} className="shrink-0" />}
                      {tone === "unresolved" && <AlertTriangle size={10} className="shrink-0" />}
                      {tone === "off" && <Radio size={10} className="shrink-0" />}
                      {label}
                    </span>
                  </span>
                </button>
              );
            })}
            {resolved.length === 0 && (
              <p className="px-1 py-2 text-xs text-[#87908A]">No members to show yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedInfoPanel({
  member,
  location,
  activeDetail,
  activeDetailRoom,
  isOwnLocation,
  onClose,
}: {
  member: Member;
  location: LocationResult;
  activeDetail: GroupMemberEntry["entry"] | null;
  activeDetailRoom: string | null;
  isOwnLocation: boolean;
  onClose: () => void;
}) {
  const { label, tone } = describeLocation(location);

  return (
    <div className="absolute bottom-3 left-3 right-3 z-[500] rounded-2xl border border-[#D0CEC4] bg-white/95 p-4 shadow-elevated backdrop-blur-sm md:left-3 md:right-auto md:w-80">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#214746]">{member.full_name}</p>
          <p
            className={`mt-0.5 flex items-center gap-1 text-xs ${
              tone === "pinned" ? "text-[#286057]" : tone === "unresolved" ? "text-[#8A6A1F]" : "text-[#87908A]"
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

      {/* Build plan Phase 4: distinct banner + "help us add it" CTA for the
          building-unresolved state (resolver state 5) — no coordinates to
          plot on the physical map, so this banner + the roster/label
          above are the only place this state is represented. */}
      {location.state === "building-unresolved" && (
        <div className="mt-3 rounded-xl border border-[#DDB35A]/50 bg-[#FBF2D9] p-3">
          <p className="flex items-start gap-2 text-xs text-[#8A6A1F]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              {isOwnLocation ? "Your" : `${member.full_name}'s`} building seems to be missing on
              our map. Please help us add it!
            </span>
          </p>
          <BuildingSubmissionPrompt rawRoom={location.rawRoom} isOwnLocation={isOwnLocation} />
        </div>
      )}

      <div className="mt-3 border-t border-[#E1DFD7] pt-3">
        {activeDetail ? (
          <>
            <p className="text-sm font-semibold text-[#214746]">
              {activeDetail.subject} {activeDetail.number}
              {activeDetail.section && (
                <span className="ml-1 text-xs font-normal text-[#87908A]">{activeDetail.section}</span>
              )}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-[#717972]">
              <Clock size={11} />
              {activeDetail.start_display}–{activeDetail.end_display}
            </p>
            <p className="mt-1 text-xs text-[#717972]">
              Room: {activeDetailRoom ?? "—"}
            </p>
          </>
        ) : (
          <p className="text-xs text-[#87908A]">Not in class right now.</p>
        )}
      </div>
    </div>
  );
}
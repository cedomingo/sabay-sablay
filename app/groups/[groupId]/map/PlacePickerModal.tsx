"use client";

/**
 * Map feature, Phase 5 — the shared "drop a pin on the map" picker/
 * submission component (build plan §5). One component, two callers:
 *
 *  - Phase 4's `BuildingSubmissionPrompt` ("Help us add it", opened from
 *    the Map tab for resolver state 5 / building-unresolved). No
 *    `entryId` is passed — the submission only ever lands in
 *    `candidate_place_submissions` for later admin review.
 *
 *  - Phase 3's TBA resolution prompt ("Can't find your building on the
 *    list?" link, build plan §A option 3). Pass `entryId` (the schedule
 *    entry being resolved) so a successful submission ALSO writes that
 *    entry's `custom_lat`/`custom_lng` override immediately, per §A:
 *    "usable immediately for that user's own map display — it doesn't
 *    need to wait on the admin-review pipeline... only to eventually
 *    become an official place/CRS mapping."
 *
 * NOTE ON SCOPE: this patch was built from the Phase 4 zip only
 * (`MapTab.tsx` + `BuildingSubmissionPrompt.tsx`) — Phase 3's actual
 * file wasn't part of that handoff, so its call site isn't edited here.
 * See PHASE-5-README.md for the exact snippet + the assumptions this
 * component makes about `submitCandidatePlace` and the overrides table
 * that Phase 3's real file should be checked against.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, MapPinOff, Loader2, Check } from "lucide-react";
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  CAMPUS_CENTER,
  CAMPUS_DEFAULT_ZOOM,
} from "@/lib/map/tileConfig";
import { submitCandidatePlace } from "@/lib/actions/candidate-place-submissions";
import PinIcon from "@/lib/map/Pin.png";

export interface PlacePickerModalProps {
  open: boolean;
  onClose: () => void;
  /** The raw, unresolved room string (e.g. "GUSALI 2-E") — shown back for context. */
  rawRoom: string;
  /** Same "Your..." vs "Their..." framing convention as BuildingSubmissionPrompt. */
  isOwnLocation: boolean;
  /**
   * Present only for Phase 3's "can't find it" flow — see file doc
   * comment above. When set, a successful submission also becomes that
   * schedule entry's location override.
   */
  entryId?: string;
  onSubmitted?: (result: { lat: number; lng: number; label: string }) => void;
}

type Status = "idle" | "submitting" | "done" | "error";

export default function PlacePickerModal({
  open,
  onClose,
  rawRoom,
  isOwnLocation,
  entryId,
  onSubmitted,
}: PlacePickerModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Init the map fresh each time the modal opens (and tear it down on
  // close) rather than trying to keep a single instance alive across a
  // conditionally-unmounted container — same pattern as MapTab's own
  // mount effect, just re-triggerable.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: CAMPUS_CENTER,
        zoom: CAMPUS_DEFAULT_ZOOM,
      });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: TILE_MAX_ZOOM }).addTo(map);

      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        setPin({ lat: e.latlng.lat, lng: e.latlng.lng });
      });

      mapRef.current = map;
      // The modal (and therefore this container) may render at zero size
      // for a frame before the CSS transition settles — nudge Leaflet to
      // recompute once it has real dimensions, or tiles render cropped.
      setTimeout(() => map.invalidateSize(), 50);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [open]);

  // Keep a single draggable marker in sync with the dropped/dragged pin.
  useEffect(() => {
    if (!mapRef.current || !pin) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;

      // Custom pin icon using the local Pin.png
      const pinIcon = L.icon({
        iconUrl: PinIcon.src,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([pin.lat, pin.lng]);
      } else {
        const marker = L.marker([pin.lat, pin.lng], { draggable: true, icon: pinIcon }).addTo(mapRef.current);
        marker.on("dragend", () => {
          const ll = marker.getLatLng();
          setPin({ lat: ll.lat, lng: ll.lng });
        });
        markerRef.current = marker;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin]);

  const reset = useCallback(() => {
    setPin(null);
    setLabel("");
    setStatus("idle");
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    // Let the caller's close (e.g. an unmount transition) happen before
    // wiping local state, so nothing visibly flashes back to "idle" first.
    setTimeout(reset, 200);
  }, [onClose, reset]);

  const handleSubmit = useCallback(async () => {
    if (!pin) return;
    setStatus("submitting");
    setError(null);
    try {
      const finalLabel = label.trim() || rawRoom || "Custom pin";
      await submitCandidatePlace({
        rawRoom,
        label: finalLabel,
        lat: pin.lat,
        lng: pin.lng,
        scheduleEntryId: entryId,
      });
      setStatus("done");
      onSubmitted?.({ lat: pin.lat, lng: pin.lng, label: finalLabel });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }, [pin, label, rawRoom, entryId, onSubmitted]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/30 p-4"
      onClick={handleClose}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-[#214746]">Drop a pin</h3>
            <p className="mt-0.5 text-xs text-[#717972]">
              {isOwnLocation ? "Your" : "This"} class&apos;s room (
              <span className="font-mono">{rawRoom || "no room listed"}</span>) — tap the map where
              it actually meets.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5]"
          >
            <X size={16} />
          </button>
        </div>

        {status === "done" ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl bg-white px-4 py-8 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#DCEEE7] text-[#286057]">
              <Check size={20} />
            </div>
            <p className="text-sm font-semibold text-[#214746]">Thanks — pin submitted!</p>
            <p className="text-xs text-[#717972]">
              {entryId
                ? "You'll see it on your map right away. We'll also review it to add the building for everyone."
                : "We use these to prioritize which buildings to map next."}
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 w-full rounded-xl bg-[#214746] px-5 py-2.5 text-sm font-semibold text-[#F4F1E9]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="relative mt-3 overflow-hidden rounded-2xl border border-[#D0CEC4]">
              <div ref={mapContainerRef} className="h-64 w-full" />
              {!pin && (
                <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
                  <span className="rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-[#717972] shadow-card">
                    Tap the map to drop a pin
                  </span>
                </div>
              )}
            </div>

            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-[#87908A]">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={rawRoom || "e.g. Ground floor, room past the stairs"}
              maxLength={80}
              className="mt-1 w-full rounded-xl border border-[#D0CEC4] bg-white px-3 py-2 text-sm text-[#214746] outline-none focus:border-[#214746]"
            />

            {error && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[#B3441F]">
                <MapPinOff size={12} />
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={!pin || status === "submitting"}
              onClick={handleSubmit}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#214746] px-5 py-3 text-sm font-semibold text-[#F4F1E9] transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-40"
            >
              {status === "submitting" && <Loader2 size={14} className="animate-spin" />}
              {status === "submitting" ? "Submitting…" : "Submit pin"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

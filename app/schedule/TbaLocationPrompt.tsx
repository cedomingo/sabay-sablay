"use client";

/**
 * Map feature, Phase 3 — the TBA-resolution prompt described in the build
 * plan §A. Rendered inline on any of the *current user's own* schedule
 * entries whose room is TBA/Arranged (see isTbaPromptable in
 * lib/map/resolveLocation.ts) and that hasn't already been resolved or
 * dismissed. Only ever shown to the entry's owner — this component only
 * appears on the personal /schedule page, which by construction only ever
 * shows the signed-in user's own entries, so there's no separate "is this
 * my entry" check needed here.
 *
 * A compact chip sits next to the entry; tapping it opens a small modal
 * with the three resolution options from §A, in order:
 *   1. Search/select a place (up-diliman-places.json)
 *   2. Asynchronous (explicit opt-out)
 *   3. "Can't find your building on the list? Pin it on the map!" — opens
 *      the Phase 5 shared map-picker (PlacePickerModal), passing this
 *      entry's id so a submitted pin also becomes this entry's location
 *      override immediately (build plan §A), not just a candidate row
 *      awaiting admin review.
 * "Not now" dismisses the prompt (schedule_entry_location_overrides.dismissed_at)
 * so it stops resurfacing; closing the modal any other way just closes it
 * for this visit — the chip will still be there next time.
 */

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, MapPin, Search, X, Check, PinOff } from "lucide-react";
import placesData from "@/lib/map/data/up-diliman-places.json";
import type { Place } from "@/lib/map/data/types";
import { resolveTbaWithPlace, resolveTbaAsAsync, dismissTbaPrompt } from "@/lib/actions/map";
import { toast } from "@/lib/toast";
import PlacePickerModal from "@/app/groups/[groupId]/map/PlacePickerModal";

const places = placesData as Place[];
const MAX_RESULTS = 6;

interface Props {
  entryId: string;
  /** Raw room text as stored (e.g. "TBA", "Arranged") — shown back to the user for context. */
  rawRoom: string | null;
}

export default function TbaLocationPrompt({ entryId, rawRoom }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false); // resolved or dismissed this session
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<"place" | "async" | "dismiss" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return places.slice(0, MAX_RESULTS);
    return places.filter((p) => p.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [query]);

  if (hidden) return null;

  function closeModal() {
    if (saving) return;
    setOpen(false);
    setQuery("");
  }

  async function handlePick(place: Place) {
    setSaving("place");
    try {
      await resolveTbaWithPlace(entryId, place.name);
      setHidden(true);
      setOpen(false);
      toast.success(`Saved — you'll show as at ${place.name} for this class.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  async function handleAsync() {
    setSaving("async");
    try {
      await resolveTbaAsAsync(entryId);
      setHidden(true);
      setOpen(false);
      toast.success("Got it — this class won't show a pin.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDismiss() {
    setSaving("dismiss");
    try {
      await dismissTbaPrompt(entryId);
      setHidden(true);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't dismiss that. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  function handleCantFind() {
    // Phase 5's shared PlacePickerModal, opened with this entry's id so a
    // submitted pin also becomes its location override right away — see
    // PHASE-5-README.md §3.
    setPickerOpen(true);
  }

  function handlePickerSubmitted() {
    setPickerOpen(false);
    setHidden(true);
    setOpen(false);
    toast.success("Saved — your pin will show on the map right away.");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#DDB35A]/60 bg-[#FBF2D9] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-[#8A6A1F] transition-colors hover:bg-[#F6E4B4]"
        title="This class's room is TBA — where will you actually be?"
      >
        <AlertTriangle size={9} />
        Set your spot
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4"
            onClick={closeModal}
          >
          <div
            className="w-full max-w-sm rounded-[22px] border border-[#D0CEC4] bg-[#F8F6F0] p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#FBF2D9] text-[#8A6A1F]">
                <AlertTriangle size={20} />
              </div>
              <button
                onClick={closeModal}
                disabled={!!saving}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#87908A] hover:bg-[#E7EBE5] disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>

            <h3 className="mt-4 font-display text-lg font-semibold text-[#214746]">
              Where will you actually be?
            </h3>
            <p className="mt-1 text-sm text-[#717972]">
              This class&apos;s room is {rawRoom && rawRoom.trim() ? rawRoom : "TBA"} — CRS never
              recorded a real one. Let your groupmates know where to actually find you.
            </p>

            {/* Option 1: search/select a place */}
            <div className="mt-4">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#87908A]"
                />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search a building or spot…"
                  disabled={!!saving}
                  className="w-full rounded-xl border border-[#C8C6BD] bg-white py-2.5 pl-9 pr-3 text-sm text-[#214746] outline-none placeholder:text-[#B9BDB4] focus:border-[#214746] disabled:opacity-60"
                />
              </div>

              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-0.5">
                {results.length === 0 && (
                  <p className="px-1 py-2 text-xs text-[#87908A]">No matching places.</p>
                )}
                {results.map((place) => (
                  <button
                    key={place.name}
                    type="button"
                    disabled={!!saving}
                    onClick={() => handlePick(place)}
                    className="flex w-full items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left text-sm text-[#214746] transition-colors hover:border-[#D0CEC4] hover:bg-white disabled:opacity-60"
                  >
                    <MapPin size={13} className="shrink-0 text-[#286057]" />
                    <span className="min-w-0 flex-1 truncate">{place.name}</span>
                    {saving === "place" && <Check size={13} className="shrink-0 text-[#286057]" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Option 2: Asynchronous */}
            <button
              type="button"
              onClick={handleAsync}
              disabled={!!saving}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#C8C6BD] px-4 py-2.5 text-sm font-semibold text-[#52605C] hover:bg-[#E7EBE5] disabled:opacity-60"
            >
              <PinOff size={14} />
              {saving === "async" ? "Saving…" : "Asynchronous — no pin for this class"}
            </button>

            {/* Option 3: can't find it on the list (Phase 5 stub) */}
            <button
              type="button"
              onClick={handleCantFind}
              disabled={!!saving}
              className="mt-3 w-full text-center text-xs font-semibold text-[#286057] underline decoration-dotted underline-offset-2 hover:text-[#214746] disabled:opacity-60"
            >
              Can&apos;t find your building on the list? Pin it on the map!
            </button>

            <div className="mt-4 border-t border-[#E1DFD7] pt-3 text-center">
              <button
                type="button"
                onClick={handleDismiss}
                disabled={!!saving}
                className="text-xs font-medium text-[#87908A] hover:text-[#52605C] disabled:opacity-60"
              >
                {saving === "dismiss" ? "Dismissing…" : "Not now, stop asking about this class"}
              </button>
            </div>
            </div>
          </div>,
          document.body
        )}

      <PlacePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        rawRoom={rawRoom ?? ""}
        isOwnLocation
        entryId={entryId}
        onSubmitted={handlePickerSubmitted}
      />
    </>
  );
}

"use client";

/**
 * Map feature, Phase 4 → Phase 5 — the "building not on map yet"
 * call-to-action (build plan §handoff-2 / resolver state 5: a room string
 * with a CRS-looking building-code prefix that doesn't match any place in
 * up-diliman-places.json). Rendered from MapTab's SelectedInfoPanel
 * whenever the selected member's resolved location is
 * `{ state: "building-unresolved" }`.
 *
 * As of Phase 5, tapping "Help us add it" opens the real shared picker
 * (`PlacePickerModal`, build plan §5) instead of the Phase 4 placeholder.
 * This trigger never passes an `entryId` — the Map tab's
 * building-unresolved state isn't tied to a single stable schedule entry
 * the way Phase 3's TBA prompt is, so a submission here only ever reaches
 * `candidate_place_submissions` for later admin review, never an
 * immediate location override. This component's public shape (a button +
 * a modal keyed to a rawRoom string) is unchanged from Phase 4, so
 * MapTab.tsx still doesn't need touching.
 */

import { useState } from "react";
import { MapPinOff } from "lucide-react";
import PlacePickerModal from "./PlacePickerModal";

interface Props {
  /** The raw, unresolved room string (e.g. "GUSALI 2-E") — shown back for context. */
  rawRoom: string;
  /**
   * "Your building..." when the viewer is looking at their own pin,
   * "Their building..." framing otherwise — MapTab knows which, this
   * component just adapts the copy so a group member never sees "your
   * building" pointed at someone else's class.
   */
  isOwnLocation: boolean;
}

export default function BuildingSubmissionPrompt({ rawRoom, isOwnLocation }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#DDB35A]/60 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#8A6A1F] transition-colors hover:bg-[#FBF2D9]"
      >
        <MapPinOff size={12} />
        Help us add it
      </button>

      <PlacePickerModal
        open={open}
        onClose={() => setOpen(false)}
        rawRoom={rawRoom}
        isOwnLocation={isOwnLocation}
      />
    </>
  );
}

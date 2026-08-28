"use server";

/**
 * Map feature, Phase 5 — server action backing `PlacePickerModal`.
 *
 * Phase 5 was originally built from the Phase 4 zip alone (MapTab.tsx +
 * BuildingSubmissionPrompt.tsx), so this file shipped with a few flagged
 * assumptions about repo conventions it couldn't see. Verified against the
 * real repo while merging Phases 0–6 together:
 *  - `createClient()` (`lib/supabase/server.ts`) is synchronous, not async
 *    — `await`ing it is harmless (awaiting a non-Promise just resolves to
 *    it), so no change needed there.
 *  - The unique column on `schedule_entry_location_overrides` (Phase 0
 *    migration, `00000000000013_map_location_overrides.sql`) is
 *    `schedule_entry_id`, NOT `entry_id` — and there is no `place_id`
 *    column, only `place_name`. The original upsert used the wrong column
 *    names entirely, which would have silently failed (or inserted a
 *    stray row) instead of updating the entry's override. Fixed below to
 *    match `lib/actions/map.ts`'s Phase 3 actions (`resolveTbaWithPlace`
 *    etc.), which already use `schedule_entry_id` / `onConflict:
 *    "schedule_entry_id"`.
 *  - `revalidatePath` conventions elsewhere in the repo (see
 *    `lib/actions/schedule.ts`, `lib/actions/group.ts`) call
 *    `revalidatePath("/schedule")` after a schedule/override write, and
 *    `revalidatePath(`/groups/${groupId}`)` for group-scoped ones. This
 *    action isn't handed a `groupId` anywhere in the Phase 4/5/6 component
 *    chain (`MapTab` -> `BuildingSubmissionPrompt` -> `PlacePickerModal`
 *    never threads one through), so it falls back to Next's documented
 *    dynamic-route revalidation form for the group page, and additionally
 *    revalidates `/schedule` when this submission also wrote an override,
 *    matching Phase 3's own actions.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface SubmitCandidatePlaceInput {
  /** The raw, unresolved room string this pin is standing in for. */
  rawRoom: string;
  /** Free-text label the user gave the pin (falls back to rawRoom if blank). */
  label: string;
  lat: number;
  lng: number;
  /**
   * Only set by Phase 3's "can't find it on the list" flow. When present,
   * this submission ALSO becomes that schedule entry's location override
   * — see build plan §A: a custom pin is usable immediately for the
   * submitting user's own map display, independent of admin review.
   * Phase 4's "help us add it" flow (Map tab, resolver state 5) never
   * passes this — that trigger has no single schedule entry to attach an
   * override to in the way Phase 3's does, so it only ever produces a
   * candidate_place_submissions row.
   */
  scheduleEntryId?: string;
}

export async function submitCandidatePlace(input: SubmitCandidatePlaceInput) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("You must be signed in to submit a pin.");
  }

  const { error: submissionError } = await supabase.from("candidate_place_submissions").insert({
    submitted_by: user.id,
    raw_room: input.rawRoom,
    label: input.label,
    lat: input.lat,
    lng: input.lng,
    schedule_entry_id: input.scheduleEntryId ?? null,
  });
  if (submissionError) {
    throw new Error(submissionError.message);
  }

  // Phase 3's flow only: immediately reflect the pin as this entry's
  // override, ahead of (and independent of) admin review of the
  // candidate_place_submissions row above. Mirrors resolveTbaWithPlace's
  // upsert shape in lib/actions/map.ts — only the custom-pin fields are
  // set, and place_name/is_async are explicitly cleared so a stale
  // resolution from a prior choice can't linger.
  if (input.scheduleEntryId) {
    const { error: overrideError } = await supabase
      .from("schedule_entry_location_overrides")
      .upsert(
        {
          schedule_entry_id: input.scheduleEntryId,
          custom_label: input.label,
          custom_lat: input.lat,
          custom_lng: input.lng,
          place_name: null,
          is_async: false,
        },
        { onConflict: "schedule_entry_id" }
      );
    if (overrideError) {
      throw new Error(overrideError.message);
    }
    revalidatePath("/schedule");
  }

  revalidatePath("/groups/[groupId]", "page");
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { LocationOverride } from "@/lib/map/resolveLocation";

/**
 * Fetches location overrides for a set of schedule entry ids, shaped for
 * lib/map/resolveLocation.ts. Pass every entry id the Map tab already has
 * (i.e. all of getGroupSchedule()'s entries) — RLS on
 * schedule_entry_location_overrides (Phase 0 migration) does the actual
 * visibility filtering: the caller gets back their own overrides plus any
 * group-mate's override on a non-hidden entry, and nothing else. No need to
 * pre-filter by user here.
 */
export async function getLocationOverridesForEntries(
  entryIds: string[]
): Promise<LocationOverride[]> {
  if (entryIds.length === 0) return [];

  const supabase = createClient();

  const { data, error } = await supabase
    .from("schedule_entry_location_overrides")
    .select(
      "schedule_entry_id, place_name, custom_lat, custom_lng, custom_label, is_async, dismissed_at"
    )
    .in("schedule_entry_id", entryIds);

  if (error || !data) return [];

  return data.map((row) => ({
    scheduleEntryId: row.schedule_entry_id,
    placeName: row.place_name,
    customLat: row.custom_lat,
    customLng: row.custom_lng,
    customLabel: row.custom_label,
    isAsync: row.is_async,
    dismissedAt: row.dismissed_at,
  }));
}

// ===========================================================================
// Phase 3 — writing schedule_entry_location_overrides from the TBA-
// resolution prompt (build plan §A). All three actions below share the
// same ownership check (only a schedule entry's own owner may write an
// override on it — mirrors toggleEntryHidden's pattern in
// lib/actions/schedule.ts) and the same upsert shape: only the fields
// relevant to *this* action are included in the patch, so e.g. dismissing
// never clobbers a place/async resolution that already exists, and
// resolving via a place always clears out any stale is_async/custom-pin
// values from a prior choice.
// ===========================================================================

async function assertOwnsEntry(entryId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: entry } = await supabase
    .from("schedule_entries")
    .select("id, schedules!inner(user_id)")
    .eq("id", entryId)
    .single();

  if (!entry) throw new Error("Entry not found");
  if ((entry.schedules as any)?.user_id !== user.id) {
    throw new Error("Not authorized");
  }

  return supabase;
}

/**
 * Resolution option 1 (build plan §A): the entry owner picked a place from
 * up-diliman-places.json for a TBA/Arranged entry.
 */
export async function resolveTbaWithPlace(entryId: string, placeName: string) {
  const supabase = await assertOwnsEntry(entryId);

  const { error } = await supabase.from("schedule_entry_location_overrides").upsert(
    {
      schedule_entry_id: entryId,
      place_name: placeName,
      is_async: false,
      custom_lat: null,
      custom_lng: null,
      custom_label: null,
    },
    { onConflict: "schedule_entry_id" }
  );

  if (error) {
    console.error("resolveTbaWithPlace error:", error);
    throw new Error("Failed to save location");
  }

  revalidatePath("/schedule");
}

/**
 * Resolution option 2 (build plan §A): explicit "this class is
 * asynchronous" opt-out — it will never produce a pin.
 */
export async function resolveTbaAsAsync(entryId: string) {
  const supabase = await assertOwnsEntry(entryId);

  const { error } = await supabase.from("schedule_entry_location_overrides").upsert(
    {
      schedule_entry_id: entryId,
      is_async: true,
      place_name: null,
      custom_lat: null,
      custom_lng: null,
      custom_label: null,
    },
    { onConflict: "schedule_entry_id" }
  );

  if (error) {
    console.error("resolveTbaAsAsync error:", error);
    throw new Error("Failed to save location");
  }

  revalidatePath("/schedule");
}

/**
 * "Not now" — dismisses the prompt for this entry without resolving it, so
 * it stops nagging the owner. Only touches dismissed_at; see the Phase 3
 * migration's header comment for why a dismissed-only row is safe.
 */
export async function dismissTbaPrompt(entryId: string) {
  const supabase = await assertOwnsEntry(entryId);

  const { error } = await supabase.from("schedule_entry_location_overrides").upsert(
    {
      schedule_entry_id: entryId,
      dismissed_at: new Date().toISOString(),
    },
    { onConflict: "schedule_entry_id" }
  );

  if (error) {
    console.error("dismissTbaPrompt error:", error);
    throw new Error("Failed to dismiss prompt");
  }

  revalidatePath("/schedule");
}

-- Map feature, Phase 3: lets a schedule entry's owner dismiss the "This
-- class's room is TBA — where will you actually be?" prompt (build plan
-- §A) without picking a place or marking the entry Asynchronous, so it
-- doesn't keep nagging them every time they load the schedule page.
--
-- A dismissed-only row (dismissed_at set, place_name/custom_lat/custom_lng
-- still null and is_async still false) intentionally still resolves to
-- "no override" in lib/map/resolveLocation.ts — see the resolver's
-- "Override row exists but has none of the three fields set" branch — so
-- dismissing the prompt never fabricates a location. It only suppresses
-- the prompt itself.

alter table public.schedule_entry_location_overrides
  add column dismissed_at timestamptz;

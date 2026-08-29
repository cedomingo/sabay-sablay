-- Map feature follow-up: lets a student attach an optional room/unit number
-- to a "Set your spot" override (build plan §A), e.g. picking the place
-- "Institute of Mathematics (IM)" and typing "304" so the schedule and map
-- can show "MB 304" instead of just the bare building name — matching the
-- <BUILDING-CODE> <ROOM-NUMBER> convention already used by CRS-derived
-- room strings (see normalizeRoom() in lib/map/resolveLocation.ts).
--
-- Purely additive UI metadata: never touches schedule_entries.room (the
-- original CRS text stays intact — see the Phase 0 migration's header
-- comment), it just gives the override enough detail to render a proper
-- replacement label instead of leaving the raw "TBA" on screen.

alter table public.schedule_entry_location_overrides
  add column custom_room text;

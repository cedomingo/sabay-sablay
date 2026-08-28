-- Map feature, Phase 0: storage for the TBA-resolution overrides described
-- in the Map feature build plan §A. When a schedule_entries.room value
-- normalizes to a "no_pin" string (TBA, Arranged, ...), the entry's owner
-- can optionally say where they'll actually be. This is an annotation
-- layered on top of the entry, not a replacement for its `room` text.
--
-- Exactly one of the following should be set on a given row (enforced at
-- the application layer in Phase 3's UI, not with a CHECK constraint here —
-- keeping v1 simple):
--   - place_name    (matched a place in up-diliman-places.json by name)
--   - custom_lat/lng (user dropped a pin that isn't in the places list)
--   - is_async = true (explicit "this class is asynchronous" opt-out)
--
-- up-diliman-places.json is static data, not a DB table, so there's no FK
-- to a places table — place_name is a plain text reference, matched by
-- name at read time in lib/map/resolveLocation.ts. See Place's doc comment
-- in lib/map/data/types.ts for why `name` is treated as the stable key.

create table public.schedule_entry_location_overrides (
  id                 uuid primary key default gen_random_uuid(),
  schedule_entry_id  uuid references public.schedule_entries(id) on delete cascade not null unique,
  place_name         text,
  custom_lat         double precision,
  custom_lng         double precision,
  custom_label       text,
  is_async           boolean not null default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table public.schedule_entry_location_overrides enable row level security;

-- Owners can fully manage overrides on their own schedule entries.
create policy "Users can view own location overrides"
  on public.schedule_entry_location_overrides for select
  using (
    exists (
      select 1
      from public.schedule_entries se
      join public.schedules s on s.id = se.schedule_id
      where se.id = schedule_entry_location_overrides.schedule_entry_id
        and s.user_id = auth.uid()
    )
  );

create policy "Users can insert own location overrides"
  on public.schedule_entry_location_overrides for insert
  with check (
    exists (
      select 1
      from public.schedule_entries se
      join public.schedules s on s.id = se.schedule_id
      where se.id = schedule_entry_location_overrides.schedule_entry_id
        and s.user_id = auth.uid()
    )
  );

create policy "Users can update own location overrides"
  on public.schedule_entry_location_overrides for update
  using (
    exists (
      select 1
      from public.schedule_entries se
      join public.schedules s on s.id = se.schedule_id
      where se.id = schedule_entry_location_overrides.schedule_entry_id
        and s.user_id = auth.uid()
    )
  );

create policy "Users can delete own location overrides"
  on public.schedule_entry_location_overrides for delete
  using (
    exists (
      select 1
      from public.schedule_entries se
      join public.schedules s on s.id = se.schedule_id
      where se.id = schedule_entry_location_overrides.schedule_entry_id
        and s.user_id = auth.uid()
    )
  );

-- Group members can read overrides for OTHER members' non-hidden entries —
-- mirrors the exact "hidden = false + shared group" shape of the
-- schedule_entries cross-group SELECT policy added in
-- 00000000000005_security_fixes.sql, so the Map tab can resolve a
-- group-mate's TBA override the same way it resolves their entry's room.
-- A hidden entry's override (if any) stays invisible to everyone but its
-- owner, same as the entry itself.
create policy "Group members can view non-hidden members' location overrides"
  on public.schedule_entry_location_overrides for select
  using (
    exists (
      select 1
      from public.schedule_entries se
      join public.schedules s on s.id = se.schedule_id
      where se.id = schedule_entry_location_overrides.schedule_entry_id
        and coalesce(se.hidden, false) = false
        and exists (
          select 1
          from public.group_members gm_self
          join public.group_members gm_other on gm_other.group_id = gm_self.group_id
          where gm_self.user_id = auth.uid()
            and gm_other.user_id = s.user_id
        )
    )
  );

create index schedule_entry_location_overrides_entry_idx
  on public.schedule_entry_location_overrides(schedule_entry_id);

-- Map feature, Phase 5 — capture-only table for pins dropped through
-- PlacePickerModal (build plan §5 / §D). Deliberately minimal: no status
-- workflow beyond a simple flag, no admin UI. Designing real
-- admin-review/approval tooling and any auto-merge into
-- up-diliman-places.json is out of scope here (build plan §D) — this is
-- just capture, so nothing is lost while that's built later.
--
-- References confirmed against the real repo while merging Phases 0-6:
-- `public.schedule_entries(id)` (Phase 0) and Supabase's built-in
-- `auth.users` both exist as assumed. Renumbered from the patch's
-- placeholder `0005_...` to this repo's actual 14-digit sequential
-- migration naming (Phases 0-3 used up through
-- 00000000000014_tba_prompt_dismissal.sql), and schema-qualified with
-- `public.` to match every other migration in this repo.

create table if not exists public.candidate_place_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users (id) on delete cascade,
  raw_room text not null,
  label text not null,
  lat double precision not null,
  lng double precision not null,
  -- Set only when the submission came from Phase 3's "can't find it on
  -- the list" flow (i.e. it also became that entry's location override).
  -- Null for Phase 4's Map-tab "help us add it" flow.
  schedule_entry_id uuid references public.schedule_entries (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists candidate_place_submissions_status_idx
  on public.candidate_place_submissions (status);

alter table public.candidate_place_submissions enable row level security;

-- Anyone signed in can flag a pin, but only as themselves.
create policy "Users can submit their own candidate places"
  on public.candidate_place_submissions
  for insert
  with check (auth.uid() = submitted_by);

-- Users can see their own submissions (e.g. to avoid re-prompting on the
-- same room). Admin review access is out of scope here (§D) — add a
-- service-role or admin-flag policy when that's built.
create policy "Users can view their own candidate places"
  on public.candidate_place_submissions
  for select
  using (auth.uid() = submitted_by);

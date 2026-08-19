-- Phase 2: Auth, Upload & Schedule Parsing
-- Creates profiles, schedules, schedule_entries tables.
-- Every table has RLS enabled from creation.

-- ============================================================
-- PROFILES
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  school_email text,
  avatar_url  text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Users can insert their own profile (needed for the trigger)
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================================
-- Auto-create profile on signup via trigger
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, school_email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'email', new.raw_user_meta_data ->> 'school_email')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- SCHEDULES
-- ============================================================
create table public.schedules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.profiles(id) on delete cascade not null,
  label            text,
  total_units      numeric,
  source_image_path text,
  created_at       timestamptz default now()
);

alter table public.schedules enable row level security;

-- Users can read their own schedules
create policy "Users can view own schedules"
  on public.schedules for select
  using (auth.uid() = user_id);

-- Users can insert their own schedules
create policy "Users can insert own schedules"
  on public.schedules for insert
  with check (auth.uid() = user_id);

-- Users can update their own schedules
create policy "Users can update own schedules"
  on public.schedules for update
  using (auth.uid() = user_id);

-- Users can delete their own schedules
create policy "Users can delete own schedules"
  on public.schedules for delete
  using (auth.uid() = user_id);

-- ============================================================
-- SCHEDULE ENTRIES
-- ============================================================
create table public.schedule_entries (
  id                 uuid primary key default gen_random_uuid(),
  schedule_id        uuid references public.schedules(id) on delete cascade not null,
  day                text not null,
  start_display      text not null,
  end_display        text not null,
  start_minutes      int not null,
  end_minutes        int not null,
  subject            text,
  number             text,
  section            text,
  course_raw         text,
  hidden             boolean default false,
  -- CRS-Monitor enrichment columns (all nullable)
  crs_class_code     text,
  room               text,
  available_slots    int,
  total_slots        int,
  enrichment_matched boolean default false,
  created_at         timestamptz default now()
);

alter table public.schedule_entries enable row level security;

-- Users can read their own schedule entries
create policy "Users can view own schedule entries"
  on public.schedule_entries for select
  using (
    exists (
      select 1 from public.schedules
      where schedules.id = schedule_entries.schedule_id
        and schedules.user_id = auth.uid()
    )
  );

-- Users can insert their own schedule entries
create policy "Users can insert own schedule entries"
  on public.schedule_entries for insert
  with check (
    exists (
      select 1 from public.schedules
      where schedules.id = schedule_entries.schedule_id
        and schedules.user_id = auth.uid()
    )
  );

-- Users can update their own schedule entries
create policy "Users can update own schedule entries"
  on public.schedule_entries for update
  using (
    exists (
      select 1 from public.schedules
      where schedules.id = schedule_entries.schedule_id
        and schedules.user_id = auth.uid()
    )
  );

-- Users can delete their own schedule entries
create policy "Users can delete own schedule entries"
  on public.schedule_entries for delete
  using (
    exists (
      select 1 from public.schedules
      where schedules.id = schedule_entries.schedule_id
        and schedules.user_id = auth.uid()
    )
  );

-- ============================================================
-- Storage bucket for schedule images (private)
-- ============================================================
-- Note: The bucket creation must be done via Supabase Dashboard or
-- the management API. This migration documents the expected state:
-- insert into storage.buckets (id, name, public) values ('schedule-images', 'schedule-images', false);

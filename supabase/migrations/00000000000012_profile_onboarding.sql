-- Adds an explicit onboarding flag so first-time signups can be asked
-- "What should we call you?" before landing anywhere else in the app.
--
-- Existing users are backfilled as already-onboarded so this doesn't
-- interrupt anyone who's already using the product; only brand-new
-- profiles (created after this migration) start out unonboarded.

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

update public.profiles
  set onboarding_completed = true
  where onboarding_completed = false;

-- New signups should default to false going forward (this is already
-- the column default, but the trigger below is made explicit for
-- clarity since it's the only place profiles are created).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, school_email, onboarding_completed)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'email', new.raw_user_meta_data ->> 'school_email'),
    false
  );
  return new;
end;
$$;

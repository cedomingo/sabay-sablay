-- Phase 2 follow-up: storage.objects RLS policies for the schedule-images
-- bucket. The bucket itself has to be created manually via the Dashboard
-- (Storage is not exposed to plain SQL), but once created, RLS on
-- storage.objects is ON by default with zero policies — meaning every
-- upload/read/delete is silently denied until policies exist. This was
-- missing, which is why image uploads were failing with
-- "Failed to upload image".
--
-- Files are stored as `schedule-images/{user_id}/{timestamp}-{filename}`
-- (see app/api/schedule/parse/route.ts), so we scope access to each
-- user's own folder using the first path segment.

-- Users can upload files into their own folder
create policy "Users can upload their own schedule images"
  on storage.objects for insert
  with check (
    bucket_id = 'schedule-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read their own uploaded files
create policy "Users can view their own schedule images"
  on storage.objects for select
  using (
    bucket_id = 'schedule-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete their own uploaded files (e.g. re-uploading a schedule)
create policy "Users can delete their own schedule images"
  on storage.objects for delete
  using (
    bucket_id = 'schedule-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

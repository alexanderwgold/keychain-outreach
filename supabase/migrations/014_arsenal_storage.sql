-- supabase/migrations/014_arsenal_storage.sql

-- Create the bucket (public = false; access through signed URLs only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arsenal',
  'arsenal',
  false,
  52428800, -- 50 MB
  array['application/pdf', 'text/csv', 'image/png', 'image/jpeg']
) on conflict (id) do nothing;

-- SELECT: anyone authenticated can read (needed by redirect handler; service role also works)
create policy "arsenal_storage_read_authed" on storage.objects
  for select using (bucket_id = 'arsenal' and auth.role() = 'authenticated');

-- INSERT: admins upload global, reps upload under their own prefix `private/{email}/...`
create policy "arsenal_storage_insert_admin_global" on storage.objects
  for insert with check (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'global'
    and is_admin()
  );

create policy "arsenal_storage_insert_rep_private" on storage.objects
  for insert with check (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'private'
    and (storage.foldername(name))[2] = (auth.jwt() ->> 'email')
  );

-- DELETE: owners can delete their own objects; admins can delete global
create policy "arsenal_storage_delete_admin_global" on storage.objects
  for delete using (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'global'
    and is_admin()
  );

create policy "arsenal_storage_delete_rep_private" on storage.objects
  for delete using (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'private'
    and (storage.foldername(name))[2] = (auth.jwt() ->> 'email')
  );

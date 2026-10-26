-- Receipt photos: private bucket. Signed-in users can view all photos
-- (prices are shared among friends) and upload only into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "receipts readable when signed in" on storage.objects;
create policy "receipts readable when signed in" on storage.objects for select to authenticated
  using (bucket_id = 'receipts');

drop policy if exists "receipts upload to own folder" on storage.objects;
create policy "receipts upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts delete own" on storage.objects;
create policy "receipts delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

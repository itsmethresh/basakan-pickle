-- Keep the customer-facing QR publicly readable, while enforcing upload
-- constraints at the bucket and blocking non-admin writes despite permissive
-- storage policies defined elsewhere.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists assets_insert_admin_guard on storage.objects;
create policy assets_insert_admin_guard on storage.objects as restrictive for insert to public
with check (bucket_id <> 'assets' or public.is_admin());

drop policy if exists assets_update_admin_guard on storage.objects;
create policy assets_update_admin_guard on storage.objects as restrictive for update to public
using (bucket_id <> 'assets' or public.is_admin())
with check (bucket_id <> 'assets' or public.is_admin());

drop policy if exists assets_delete_admin_guard on storage.objects;
create policy assets_delete_admin_guard on storage.objects as restrictive for delete to public
using (bucket_id <> 'assets' or public.is_admin());

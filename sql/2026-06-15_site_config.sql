-- =============================================================================
-- UnderBro · Personalización global + bucket de imágenes para el editor (/editor)
-- Lectura pública; escritura solo admin. Ejecútalo en el SQL Editor.
-- =============================================================================

-- 1) Configuración global (una sola fila)
create table if not exists public.site_config (
  id int primary key default 1,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  constraint site_config_singleton check (id = 1)
);
alter table public.site_config enable row level security;
drop policy if exists sc_select on public.site_config;
create policy sc_select on public.site_config for select using (true);
drop policy if exists sc_write on public.site_config;
create policy sc_write on public.site_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
insert into public.site_config (id, config) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- 2) Bucket público para las imágenes que subas en el editor
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets','site-assets', true, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site_assets_read" on storage.objects;
create policy "site_assets_read" on storage.objects for select
  using (bucket_id = 'site-assets');
drop policy if exists "site_assets_insert" on storage.objects;
create policy "site_assets_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-assets' and public.is_admin());
drop policy if exists "site_assets_update" on storage.objects;
create policy "site_assets_update" on storage.objects for update to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());
drop policy if exists "site_assets_delete" on storage.objects;
create policy "site_assets_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());

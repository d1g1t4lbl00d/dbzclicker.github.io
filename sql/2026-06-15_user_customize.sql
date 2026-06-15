-- =============================================================================
-- UnderBro · Personalización POR USUARIO (cada usuario su propia web)
--  - profiles.can_customize: permiso que concede el admin
--  - user_site_config: config personal (solo la ve/edita su dueño)
--  - storage: quienes pueden personalizar suben imágenes a SU carpeta (uid/...)
-- Ejecuta todo en el SQL Editor.
-- =============================================================================

-- 1) permiso
alter table public.profiles add column if not exists can_customize boolean not null default false;

-- 2) helper: ¿el usuario actual puede personalizar? (admin siempre puede)
create or replace function public.can_customize()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select can_customize from public.profiles where id = auth.uid()), false)
      or coalesce((select is_admin     from public.profiles where id = auth.uid()), false);
$$;

-- 3) config personal por usuario
create table if not exists public.user_site_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.user_site_config enable row level security;
drop policy if exists usc_select on public.user_site_config;
create policy usc_select on public.user_site_config for select using (auth.uid() = user_id);
drop policy if exists usc_write on public.user_site_config;
create policy usc_write on public.user_site_config for all to authenticated
  using (auth.uid() = user_id and public.can_customize())
  with check (auth.uid() = user_id and public.can_customize());

-- 4) admin puede conceder/quitar el permiso (update de otros perfiles)
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 5) storage: subir/editar/borrar imágenes
--    admin: en cualquier sitio · usuarios con permiso: solo en su carpeta uid/...
drop policy if exists "site_assets_insert" on storage.objects;
create policy "site_assets_insert" on storage.objects for insert to authenticated
  with check (bucket_id='site-assets' and public.can_customize()
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "site_assets_update" on storage.objects;
create policy "site_assets_update" on storage.objects for update to authenticated
  using (bucket_id='site-assets' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "site_assets_delete" on storage.objects;
create policy "site_assets_delete" on storage.objects for delete to authenticated
  using (bucket_id='site-assets' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));
-- lectura pública se mantiene (site_assets_read)

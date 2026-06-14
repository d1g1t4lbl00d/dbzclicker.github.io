-- =============================================================================
-- UnderBro · Extras del Panel de Admin
--   1) Destacar pistas en Trending (columna tracks.featured + permiso de update)
--   2) Otorgar/quitar insignias a usuarios (políticas RLS en user_badges)
-- No necesita secreto. Ejecútalo en el SQL Editor.
-- =============================================================================

-- 1) DESTACAR PISTAS ----------------------------------------------------------
alter table public.tracks add column if not exists featured boolean not null default false;
create index if not exists tracks_featured_idx on public.tracks (featured) where featured;

-- permitir a los admins ACTUALIZAR cualquier pista (para marcar featured).
-- Es una política permisiva extra: se suma (OR) a la de actualizar las propias.
drop policy if exists tracks_admin_update on public.tracks;
create policy tracks_admin_update on public.tracks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 2) INSIGNIAS (user_badges) --------------------------------------------------
-- los admins pueden conceder y retirar insignias a cualquiera
drop policy if exists ub_admin_insert on public.user_badges;
create policy ub_admin_insert on public.user_badges for insert to authenticated
  with check (public.is_admin());
drop policy if exists ub_admin_delete on public.user_badges;
create policy ub_admin_delete on public.user_badges for delete to authenticated
  using (public.is_admin());

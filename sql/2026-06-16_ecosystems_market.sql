-- =============================================================================
-- UnderBro · Mercado en Ecosystems + "Ser creador"
--  - Cualquier usuario puede aplicar un diseño a SU PROPIA vista (user_site_config).
--    (Crear/publicar en el editor sigue siendo solo de creadores con can_customize.)
--  - creator_requests: solicitudes para que el admin conceda can_customize.
-- Ejecuta en el SQL Editor.
-- =============================================================================

-- aplicar skins: permitir a cualquiera guardar SOLO su propia fila
drop policy if exists usc_write on public.user_site_config;
create policy usc_write on public.user_site_config for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- solicitudes para ser creador
create table if not exists public.creator_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  created_at timestamptz default now()
);
alter table public.creator_requests enable row level security;
drop policy if exists cr_insert on public.creator_requests;
create policy cr_insert on public.creator_requests for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists cr_select on public.creator_requests;
create policy cr_select on public.creator_requests for select to authenticated
  using (auth.uid() = user_id or public.is_admin());
drop policy if exists cr_delete on public.creator_requests;
create policy cr_delete on public.creator_requests for delete to authenticated
  using (public.is_admin() or auth.uid() = user_id);

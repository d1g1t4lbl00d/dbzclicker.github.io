-- =============================================================================
-- UnderBro · Mercado de webs (galería pública de diseños/temas)
--  Cualquiera con can_customize puede publicar su diseño; todos pueden verlos;
--  el admin (o el autor) puede borrarlos. Ejecuta en el SQL Editor.
-- =============================================================================
create table if not exists public.theme_market (
  id uuid primary key default gen_random_uuid(),
  author uuid references auth.users(id) on delete set null,
  author_name text,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.theme_market enable row level security;

drop policy if exists tm_select on public.theme_market;
create policy tm_select on public.theme_market for select using (true);

drop policy if exists tm_insert on public.theme_market;
create policy tm_insert on public.theme_market for insert to authenticated
  with check (author = auth.uid() and public.can_customize());

drop policy if exists tm_update on public.theme_market;
create policy tm_update on public.theme_market for update to authenticated
  using (author = auth.uid() or public.is_admin());

drop policy if exists tm_delete on public.theme_market;
create policy tm_delete on public.theme_market for delete to authenticated
  using (author = auth.uid() or public.is_admin());

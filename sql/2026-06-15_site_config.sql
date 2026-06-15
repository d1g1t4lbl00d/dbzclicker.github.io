-- =============================================================================
-- UnderBro · Personalización global de la web (editor en /editor, solo admin)
-- Una sola fila (id=1) con un JSON de configuración. Lectura pública (para que
-- la app lo aplique a todos); escritura solo admin.
-- Ejecútalo en el SQL Editor.
-- =============================================================================

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

-- Tienda por perfil (escaparate; pago por enlace externo, descarga directa si es gratis)
create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'merch',     -- beat | merch | ticket
  title text not null,
  price text,
  is_free boolean not null default false,
  description text,
  image_url text,
  file_url text,
  buy_url text,
  event_date timestamptz,
  event_place text,
  sort int not null default 0,
  created_at timestamptz default now()
);
alter table public.shop_products enable row level security;
drop policy if exists sp_select on public.shop_products;
create policy sp_select on public.shop_products for select using (true);
drop policy if exists sp_ins on public.shop_products;
create policy sp_ins on public.shop_products for insert to authenticated with check (user_id = auth.uid());
drop policy if exists sp_upd on public.shop_products;
create policy sp_upd on public.shop_products for update to authenticated using (user_id = auth.uid());
drop policy if exists sp_del on public.shop_products;
create policy sp_del on public.shop_products for delete to authenticated using (user_id = auth.uid());
grant select on public.shop_products to anon, authenticated;
grant insert, update, delete on public.shop_products to authenticated;
create index if not exists sp_user_idx on public.shop_products(user_id, sort, created_at);

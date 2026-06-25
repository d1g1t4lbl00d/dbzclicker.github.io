-- Admin, envíos y restauración de stock para el sistema de compra/venta

-- helper admin (security definer, evita recursión RLS)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_admin() to authenticated, anon;

-- admin ve todos los pedidos y modera productos
drop policy if exists so_select_admin on public.shop_orders;
create policy so_select_admin on public.shop_orders for select to authenticated using (public.is_admin());
drop policy if exists sp_admin_del on public.shop_products;
create policy sp_admin_del on public.shop_products for delete to authenticated using (public.is_admin());
drop policy if exists sp_admin_upd on public.shop_products;
create policy sp_admin_upd on public.shop_products for update to authenticated using (public.is_admin());

-- estado de envío
alter table public.shop_orders add column if not exists shipped boolean not null default false;
alter table public.shop_orders add column if not exists shipped_at timestamptz;

-- el vendedor marca un pedido como enviado (solo ese campo)
create or replace function public.shop_mark_shipped(o_id uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.shop_orders set shipped = val, shipped_at = case when val then now() else null end
  where id = o_id and seller_id = auth.uid();
end; $$;
grant execute on function public.shop_mark_shipped(uuid, boolean) to authenticated;

-- restaurar stock al reembolsar
create or replace function public.shop_increment_stock(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.shop_products set stock = stock + 1 where id = p_id and stock is not null;
$$;
revoke all on function public.shop_increment_stock(uuid) from public;
grant execute on function public.shop_increment_stock(uuid) to service_role;

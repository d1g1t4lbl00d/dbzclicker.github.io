-- Stock por producto + descuento atómico al vender (anti "comprado pero sigue a la venta")
alter table public.shop_products add column if not exists stock int; -- null = ilimitado

create or replace function public.shop_decrement_stock(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shop_products set stock = stock - 1
  where id = p_id and stock is not null and stock > 0;
$$;
revoke all on function public.shop_decrement_stock(uuid) from public;
grant execute on function public.shop_decrement_stock(uuid) to service_role;

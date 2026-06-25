-- Dos secciones mayores en la tienda: Digital (pago + descarga) y Físico (con envío)
alter table public.shop_products add column if not exists kind text not null default 'digital';
update public.shop_products set kind = 'physical' where (needs_shipping = true or type = 'merch') and kind = 'digital';

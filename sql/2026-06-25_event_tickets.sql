-- Entradas a eventos: validación de un solo uso (presencial) + acceso online
alter table public.shop_orders add column if not exists ticket_used boolean not null default false;
alter table public.shop_orders add column if not exists ticket_used_at timestamptz;
alter table public.shop_products add column if not exists event_online boolean not null default false;
alter table public.shop_products add column if not exists event_url text;

-- El organizador valida una entrada por su código (one-time, solo sus eventos)
create or replace function public.shop_redeem_ticket(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.shop_orders
    where ticket_code = p_code and seller_id = auth.uid() and status = 'paid' limit 1;
  if not found then return json_build_object('result', 'invalid'); end if;
  if o.ticket_used then
    return json_build_object('result', 'used', 'title', o.title, 'used_at', o.ticket_used_at, 'buyer_email', o.buyer_email);
  end if;
  update public.shop_orders set ticket_used = true, ticket_used_at = now() where id = o.id;
  return json_build_object('result', 'ok', 'title', o.title, 'buyer_email', o.buyer_email);
end; $$;
grant execute on function public.shop_redeem_ticket(text) to authenticated;

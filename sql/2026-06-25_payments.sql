-- Pagos in-app (marketplace con Stripe Connect) — UnderBro cobra y reparte comisión
-- Estado de Stripe Connect en el perfil del vendedor
alter table public.profiles add column if not exists stripe_account_id text;
alter table public.profiles add column if not exists stripe_ready boolean not null default false;

-- Producto: cobro dentro de la app
alter table public.shop_products add column if not exists price_cents int;            -- precio en céntimos para cobro in-app
alter table public.shop_products add column if not exists currency text not null default 'eur';
alter table public.shop_products add column if not exists pay_inapp boolean not null default false; -- true = checkout dentro de UnderBro

-- Pedidos
create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.shop_products(id) on delete set null,
  seller_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid references auth.users(id) on delete set null,
  buyer_email text,
  title text,
  type text,
  amount_cents int not null,
  fee_cents int not null default 0,
  currency text not null default 'eur',
  status text not null default 'pending',          -- pending | paid | refunded | canceled
  stripe_session_id text,
  stripe_payment_intent text,
  download_token text,
  ticket_code text,
  created_at timestamptz default now(),
  paid_at timestamptz
);
alter table public.shop_orders enable row level security;
-- comprador y vendedor pueden ver sus propios pedidos; las escrituras solo desde el servidor (service role)
drop policy if exists so_select on public.shop_orders;
create policy so_select on public.shop_orders for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());
grant select on public.shop_orders to authenticated;
create index if not exists so_seller_idx on public.shop_orders(seller_id, created_at desc);
create index if not exists so_buyer_idx on public.shop_orders(buyer_id, created_at desc);
create index if not exists so_session_idx on public.shop_orders(stripe_session_id);
create index if not exists so_pi_idx on public.shop_orders(stripe_payment_intent);

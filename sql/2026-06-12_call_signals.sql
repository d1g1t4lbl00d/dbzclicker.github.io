-- Señalización fiable para llamadas (aplicado el 2026-06-12).
-- Problema: las señales WebRTC (oferta/respuesta/ICE/colgar) iban SOLO por
-- canales broadcast de Supabase Realtime, que no garantizan la entrega. Si una
-- señal se perdía, la llamada se quedaba en "Conectando…" para siempre.
-- Solución: cada señal se envía por DOS vías — broadcast (instantánea) y esta
-- tabla con postgres_changes (entrega garantizada, el mismo mecanismo probado
-- de los DMs). El receptor deduplica por `sig`. Además, al abrir la app se
-- procesan las señales de los últimos 45s (llamada entrante con app cerrada).

create table if not exists public.call_signals (
  id bigint generated always as identity primary key,
  call_id text not null,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,                     -- offer | answer | ice | reject | cancel | hangup
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.call_signals enable row level security;

create policy cs_insert on public.call_signals for insert
  with check ((select auth.uid()) = sender_id);
create policy cs_select on public.call_signals for select
  using ((select auth.uid()) = recipient_id or (select auth.uid()) = sender_id);
create policy cs_delete on public.call_signals for delete
  using ((select auth.uid()) = recipient_id or (select auth.uid()) = sender_id);

create index if not exists call_signals_recipient_idx on public.call_signals (recipient_id, created_at);
create index if not exists call_signals_call_idx on public.call_signals (call_id);

revoke all on public.call_signals from anon;
grant select, insert, delete on public.call_signals to authenticated;

alter publication supabase_realtime add table public.call_signals;

-- Limpieza: cada cliente borra las señales de su llamada al terminar
-- (cleanupCall) y las antiguas (>45s) al arrancar la app.

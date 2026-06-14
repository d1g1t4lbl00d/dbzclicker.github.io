-- =============================================================================
-- UnderBro · Difusión global de admin (Panel de Admin → "Enviar a todos")
-- -----------------------------------------------------------------------------
-- El cliente (solo admin) inserta una fila en broadcasts; un trigger llama a la
-- edge function send-push, que manda el aviso a TODAS las suscripciones push.
--
-- 1) Ejecuta este SQL en el SQL Editor (sustituye __X_HOOK_SECRET__ por el mismo
--    secreto que usa notify_new_dm — NO lo subas al repo).
-- 2) Añade en la edge function send-push la rama "broadcast" (ver más abajo).
-- =============================================================================

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete set null,
  title text,
  body text,
  url text default '/',
  created_at timestamptz default now()
);

alter table public.broadcasts enable row level security;

-- solo los admins pueden crear/ver difusiones
drop policy if exists bc_insert on public.broadcasts;
create policy bc_insert on public.broadcasts for insert to authenticated with check (public.is_admin());
drop policy if exists bc_select on public.broadcasts;
create policy bc_select on public.broadcasts for select to authenticated using (public.is_admin());

-- al insertarse una difusión, dispara el push a toda la comunidad
create or replace function public.notify_broadcast()
returns trigger language plpgsql security definer
set search_path to 'public', 'net', 'extensions' as $$
begin
  perform net.http_post(
    url := 'https://hvpycejcaljgpxwnykuh.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', '__X_HOOK_SECRET__'
    ),
    body := jsonb_build_object('broadcast', jsonb_build_object(
      'title', NEW.title, 'body', NEW.body, 'url', coalesce(NEW.url, '/')
    ))
  );
  return NEW;
end; $$;

drop trigger if exists trg_notify_broadcast on public.broadcasts;
create trigger trg_notify_broadcast after insert on public.broadcasts
  for each row execute function public.notify_broadcast();

revoke execute on function public.notify_broadcast() from public, anon, authenticated;

-- =============================================================================
-- RAMA A AÑADIR EN LA EDGE FUNCTION send-push (justo después de la rama "notify"):
-- -----------------------------------------------------------------------------
--   // difusión global a toda la comunidad (admin)
--   if (body.broadcast) {
--     const b = body.broadcast;
--     const { data: subs } = await supabase.from('push_subscriptions').select('id,subscription');
--     const payload = JSON.stringify({
--       title: b.title || 'UnderBro',
--       body: String(b.body || '').slice(0, 160),
--       tag: 'broadcast', url: b.url || '/',
--     });
--     const dead = [];
--     await Promise.all((subs || []).map(async (s) => {
--       try { await webpush.sendNotification(s.subscription, payload); }
--       catch (err) { const sc = err && err.statusCode; if (sc === 404 || sc === 410) dead.push(s.id); }
--     }));
--     if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead);
--     return json({ sent: (subs || []).length - dead.length });
--   }
-- =============================================================================

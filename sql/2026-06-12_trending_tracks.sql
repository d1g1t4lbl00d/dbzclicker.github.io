-- Trending dinámico (hot score con ventana reciente) — aplicado el 2026-06-12.
-- Problema: la pestaña Trending ordenaba por `plays` acumulado, así que siempre
-- salían las pistas más antiguas (más tiempo = más reproducciones). Ahora se usa
-- un "hot score" que prioriza la interacción RECIENTE.
--
-- Nota de diseño: no existe registro de reproducciones con fecha (`plays` es un
-- contador acumulado), por lo que no se pueden medir "repros de los últimos N
-- días". Sí se miden likes, reposts y comentarios recientes (tienen created_at),
-- que son la señal más fuerte de tendencia. Si en el futuro se quiere "repros por
-- ventana", habría que añadir una tabla de eventos de reproducción (play_events).

create or replace function public.trending_tracks(p_days int default 2, p_limit int default 50)
returns setof public.tracks
language sql
stable
set search_path = public
as $$
  with win as (
    select (now() - make_interval(days => greatest(p_days, 1)))::timestamptz as since
  ),
  rl as (select l.track_id, count(*)::numeric c from likes l, win where l.created_at > win.since group by l.track_id),
  rr as (select r.track_id, count(*)::numeric c from reposts r, win where r.created_at > win.since group by r.track_id),
  rc as (select c.track_id, count(*)::numeric c from comments c, win where c.created_at > win.since group by c.track_id)
  select t.*
  from tracks t
  cross join win
  left join rl on rl.track_id = t.id
  left join rr on rr.track_id = t.id
  left join rc on rc.track_id = t.id
  order by
    coalesce(rl.c, 0) * 3            -- likes recientes
    + coalesce(rr.c, 0) * 5          -- reposts recientes (señal más fuerte)
    + coalesce(rc.c, 0) * 2.5        -- comentarios recientes
    + least(coalesce(t.plays, 0), 1000) * 0.02  -- repros acumuladas (con tope, baseline)
    + case when t.created_at > win.since then 8 else 0 end  -- empujón a novedades
    - (extract(epoch from (now() - t.created_at)) / 86400.0) * 0.2  -- decaimiento por antigüedad
    desc,
    t.plays desc nulls last,
    t.created_at desc
  limit greatest(p_limit, 1);
$$;

-- SECURITY INVOKER (por defecto): likes/reposts/comments tienen SELECT público,
-- así que ve los conteos correctos sin elevar privilegios.
revoke all on function public.trending_tracks(int, int) from public;
grant execute on function public.trending_tracks(int, int) to anon, authenticated;
